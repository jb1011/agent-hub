import fs from "node:fs";
import path from "node:path";
import { Interface, getAddress, keccak256, parseUnits, toUtf8Bytes } from "ethers";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type Deployment = {
  contracts?: {
    AgentHubRegistry?: string;
  };
};

const AGENT_HUB_REGISTRY_INTERFACE = new Interface([
  "function registerProvider(address signer, address payoutWallet, bytes32 metadataCommitment)",
  "function registerService(uint256 providerId, uint256 price, uint64 workTimeout, bytes32 metadataCommitment)",
]);

export type ProviderRegistryMetadata = {
  provider_id: string;
  name: string;
  description: string | null;
  status: string;
  owner_wallet: string;
  payout_wallet: string;
  api_base_url: string;
  trust_level: string;
  created_at: string | null;
  updated_at: string | null;
};

export type ServiceRegistryMetadata = {
  service_id: string;
  provider_id: string;
  name: string;
  description: string | null;
  service_type: string;
  endpoint_path: string;
  input_schema: unknown;
  output_schema: unknown;
  price_usdc: string | null;
  timeout_seconds: number | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
};

export type PreparedContractTransaction = {
  to: string;
  data: string;
  value: "0";
  from?: string;
  chain_id?: number;
};

export function agentHubRegistryAddress(): string {
  const envAddress = firstEnv(["AGENT_HUB_REGISTRY_ADDRESS", "REGISTRY_CONTRACT_ADDRESS"]);
  if (envAddress) return getAddress(envAddress);

  const chainId = firstEnv(["AGENT_HUB_CHAIN_ID", "ESCROW_CHAIN_ID"]);
  if (chainId) {
    const deploymentAddress = registryAddressFromDeployment(chainId);
    if (deploymentAddress) return getAddress(deploymentAddress);
  }

  throw new Error(
    "AgentHubRegistry address not configured. Set AGENT_HUB_REGISTRY_ADDRESS or AGENT_HUB_CHAIN_ID/ESCROW_CHAIN_ID with a deployments file."
  );
}

export function agentHubRegistryChainId(): number | undefined {
  const chainId = firstEnv(["AGENT_HUB_CHAIN_ID", "ESCROW_CHAIN_ID"]);
  if (!chainId) return undefined;

  const parsed = Number(chainId);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("AGENT_HUB_CHAIN_ID/ESCROW_CHAIN_ID must be a positive safe integer");
  }

  return parsed;
}

export function buildRegisterProviderCall(metadata: ProviderRegistryMetadata) {
  const registryAddress = agentHubRegistryAddress();
  const args = {
    signer: getAddress(metadata.owner_wallet),
    payout_wallet: getAddress(metadata.payout_wallet),
    metadata_commitment: metadataCommitment(metadata as unknown as JsonValue),
  };

  return {
    agent_hub_registry_address: registryAddress,
    function_name: "registerProvider" as const,
    register_provider_args: args,
    transaction: buildPreparedTransaction(
      registryAddress,
      "registerProvider",
      [args.signer, args.payout_wallet, args.metadata_commitment],
      args.signer
    ),
  };
}

export function buildRegisterServiceCall(metadata: ServiceRegistryMetadata, providerOwnerWallet?: string) {
  if (metadata.price_usdc == null) {
    throw new Error("service.price_usdc is required to build registerService args");
  }
  if (metadata.timeout_seconds == null) {
    throw new Error("service.timeout_seconds is required to build registerService args");
  }

  const registryAddress = agentHubRegistryAddress();
  const args = {
    provider_id: metadata.provider_id,
    price: parseUsdc(metadata.price_usdc),
    work_timeout: asUint64(metadata.timeout_seconds, "service.timeout_seconds"),
    metadata_commitment: metadataCommitment(metadata as unknown as JsonValue),
  };

  return {
    agent_hub_registry_address: registryAddress,
    function_name: "registerService" as const,
    register_service_args: args,
    transaction: buildPreparedTransaction(
      registryAddress,
      "registerService",
      [args.provider_id, args.price, args.work_timeout, args.metadata_commitment],
      providerOwnerWallet
    ),
  };
}

function firstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim() !== "") return value.trim();
  }

  return undefined;
}

function registryAddressFromDeployment(chainId: string): string | undefined {
  const candidates = [
    path.resolve(process.cwd(), "deployments", `${chainId}.json`),
    path.resolve(process.cwd(), "../contracts/deployments", `${chainId}.json`),
  ];
  const deploymentPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!deploymentPath) return undefined;

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as Deployment;
  return deployment.contracts?.AgentHubRegistry;
}

function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function metadataCommitment(metadata: JsonValue): string {
  return keccak256(toUtf8Bytes(stableStringify(metadata)));
}

function buildPreparedTransaction(
  registryAddress: string,
  functionName: "registerProvider" | "registerService",
  args: readonly unknown[],
  from?: string
): PreparedContractTransaction {
  const chainId = agentHubRegistryChainId();

  return {
    to: registryAddress,
    data: AGENT_HUB_REGISTRY_INTERFACE.encodeFunctionData(functionName, args),
    value: "0",
    ...(from ? { from: getAddress(from) } : {}),
    ...(chainId ? { chain_id: chainId } : {}),
  };
}

function parseUsdc(value: string): string {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) {
    throw new Error("service.price_usdc must be a positive decimal with up to 6 decimals");
  }

  const amount = parseUnits(value, 6);
  if (amount === 0n) throw new Error("service.price_usdc must be greater than 0");
  return amount.toString();
}

function asUint64(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${fieldName} must be a positive safe integer`);
  }

  return value;
}
