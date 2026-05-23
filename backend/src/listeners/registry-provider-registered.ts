import type { FastifyBaseLogger } from "fastify";
import {
  Contract,
  Interface,
  JsonRpcProvider,
  WebSocketProvider,
  getAddress,
  isHexString,
  type ContractEventPayload,
} from "ethers";
import { prisma } from "../lib/prisma.js";
import {
  agentHubRegistryAddress,
  computeProviderMetadataCommitment,
} from "../lib/registry-call.js";
import { serializeProvider } from "../lib/serialize.js";

const REGISTRY_ABI = [
  "event ProviderRegistered(uint256 indexed providerId, address indexed owner, address indexed signer, address payoutWallet, uint256 price, uint64 workTimeout, bytes32 metadataCommitment)",
] as const;

const REGISTRY_INTERFACE = new Interface(REGISTRY_ABI);

type ListenerHandle = {
  close: () => Promise<void>;
};

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function firstEnv(names: string[]): string | null {
  for (const name of names) {
    const value = env(name);
    if (value) return value;
  }
  return null;
}

function normalizeBytes32(value: string): string {
  return value.toLowerCase();
}

export async function markProviderRegistered(
  onchainProviderId: string,
  owner: string,
  metadataCommitment: string,
  txHash: string | null,
  logger: FastifyBaseLogger
) {
  const normalizedCommitment = normalizeBytes32(metadataCommitment);
  const normalizedOwner = getAddress(owner);

  const candidates = await prisma.provider.findMany({
    where: {
      OR: [
        { registry_provider_id: null },
        { registry_provider_id: onchainProviderId },
      ],
      AND: {
        OR: [
          { metadata_commitment: normalizedCommitment },
          { metadata_commitment: null },
        ],
      },
    },
    orderBy: { created_at: "desc" },
  });

  const matched = candidates.filter((provider) => {
    if (getAddress(provider.owner_wallet) !== normalizedOwner) return false;
    if (provider.metadata_commitment) {
      return normalizeBytes32(provider.metadata_commitment) === normalizedCommitment;
    }

    const commitment = computeProviderMetadataCommitment(serializeProvider(provider));
    return normalizeBytes32(commitment) === normalizedCommitment;
  });

  if (matched.length === 0) {
    logger.warn(
      { providerId: onchainProviderId, owner: normalizedOwner, metadataCommitment, txHash },
      "ProviderRegistered event did not match any local provider awaiting on-chain registration"
    );
    return;
  }

  if (matched.length > 1) {
    logger.error(
      {
        providerId: onchainProviderId,
        owner: normalizedOwner,
        metadataCommitment,
        requestIds: matched.map((p) => p.request_id),
        txHash,
      },
      "ProviderRegistered event matched multiple local providers with the same metadataCommitment"
    );
    return;
  }

  const provider = matched[0];
  const existingByRegistryId = await prisma.provider.findUnique({
    where: { registry_provider_id: onchainProviderId },
    select: { request_id: true },
  });

  if (existingByRegistryId && existingByRegistryId.request_id !== provider.request_id) {
    logger.error(
      {
        providerId: onchainProviderId,
        requestId: provider.request_id,
        conflictingRequestId: existingByRegistryId.request_id,
        txHash,
      },
      "On-chain provider id is already linked to another local provider"
    );
    return;
  }

  if (
    provider.registry_provider_id === onchainProviderId &&
    provider.status === "ACTIVE"
  ) {
    logger.info(
      { requestId: provider.request_id, providerId: onchainProviderId, txHash },
      "Local provider already active and linked to on-chain provider id"
    );
    return;
  }

  await prisma.provider.update({
    where: { request_id: provider.request_id },
    data: {
      registry_provider_id: onchainProviderId,
      metadata_commitment: normalizedCommitment,
      status: "ACTIVE",
    },
  });

  logger.info(
    {
      requestId: provider.request_id,
      providerId: onchainProviderId,
      owner: normalizedOwner,
      metadataCommitment,
      txHash,
    },
    "Local provider marked active and linked to on-chain provider id from ProviderRegistered event"
  );
}

function receiptProviderFor(url: string): JsonRpcProvider | WebSocketProvider {
  return url.startsWith("ws:") || url.startsWith("wss:")
    ? new WebSocketProvider(url)
    : new JsonRpcProvider(url);
}

async function destroyReceiptProvider(provider: JsonRpcProvider | WebSocketProvider): Promise<void> {
  await provider.destroy();
}

export async function syncProviderRegisteredFromTransaction(
  txHash: string,
  logger: FastifyBaseLogger
) {
  if (!isHexString(txHash, 32)) {
    throw new Error("tx_hash_must_be_32_byte_hex");
  }

  const rpcUrl = firstEnv(["ARC_RPC_URL", "RPC_URL", "ARC_RPC_WS_URL"]);
  if (!rpcUrl) throw new Error("missing_env_ARC_RPC_URL");

  const registryContractAddress = agentHubRegistryAddress();
  const provider = receiptProviderFor(rpcUrl);

  try {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) throw new Error("transaction_receipt_not_found");

    const synced: Array<{
      provider_id: string;
      owner: string;
      metadata_commitment: string;
    }> = [];
    const registryAddress = registryContractAddress.toLowerCase();

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== registryAddress) continue;

      let parsed;
      try {
        parsed = REGISTRY_INTERFACE.parseLog(log);
      } catch {
        continue;
      }

      if (parsed?.name !== "ProviderRegistered") continue;

      const onchainProviderId = parsed.args.providerId.toString();
      const owner = parsed.args.owner as string;
      const metadataCommitment = parsed.args.metadataCommitment as string;
      await markProviderRegistered(onchainProviderId, owner, metadataCommitment, txHash, logger);
      synced.push({
        provider_id: onchainProviderId,
        owner: getAddress(owner),
        metadata_commitment: metadataCommitment,
      });
    }

    if (synced.length === 0) throw new Error("provider_registered_event_not_found");
    return synced;
  } finally {
    await destroyReceiptProvider(provider);
  }
}

export function startRegistryProviderRegisteredListener(
  logger: FastifyBaseLogger
): ListenerHandle | null {
  if (env("REGISTRY_PROVIDER_REGISTERED_LISTENER_ENABLED") === "false") {
    logger.info(
      "Registry ProviderRegistered listener disabled by REGISTRY_PROVIDER_REGISTERED_LISTENER_ENABLED=false"
    );
    return null;
  }

  const rpcUrl = env("ARC_RPC_WS_URL");
  let registryContractAddress: string;
  try {
    registryContractAddress = agentHubRegistryAddress();
  } catch (err) {
    logger.warn(
      { err },
      "Registry ProviderRegistered listener not started: AgentHubRegistry address is not configured"
    );
    return null;
  }

  if (!rpcUrl) {
    logger.warn(
      "Registry ProviderRegistered listener not started: ARC_RPC_WS_URL must be set"
    );
    return null;
  }

  const provider = new WebSocketProvider(rpcUrl);
  const contract = new Contract(registryContractAddress, REGISTRY_ABI, provider);

  const onProviderRegistered = async (
    providerId: bigint,
    owner: string,
    signer: string,
    payoutWallet: string,
    price: bigint,
    workTimeout: bigint,
    metadataCommitment: string,
    event: ContractEventPayload
  ) => {
    const onchainProviderId = providerId.toString();
    const txHash = event.log?.transactionHash ?? null;

    logger.info(
      {
        providerId: onchainProviderId,
        owner,
        signer,
        payoutWallet,
        price: price.toString(),
        workTimeout: workTimeout.toString(),
        metadataCommitment,
        txHash,
      },
      "ProviderRegistered event received from registry contract"
    );

    try {
      await markProviderRegistered(onchainProviderId, owner, metadataCommitment, txHash, logger);
    } catch (err) {
      logger.error(
        { err, providerId: onchainProviderId, owner, metadataCommitment, txHash },
        "Failed to process ProviderRegistered event"
      );
    }
  };

  provider.on("error", (err) => {
    logger.error({ err }, "Arc websocket provider error (registry listener)");
  });

  void contract.on("ProviderRegistered", onProviderRegistered);

  logger.info(
    { rpcUrl, registryContractAddress },
    "Registry ProviderRegistered listener started"
  );

  return {
    close: async () => {
      await contract.off("ProviderRegistered", onProviderRegistered);
      await provider.destroy();
      logger.info("Registry ProviderRegistered listener stopped");
    },
  };
}
