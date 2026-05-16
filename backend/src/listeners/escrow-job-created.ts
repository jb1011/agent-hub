import type { FastifyBaseLogger } from "fastify";
import { Contract, WebSocketProvider, type ContractEventPayload } from "ethers";
import { prisma } from "../lib/prisma.js";

const ESCROW_ABI = [
  "event JobCreated(uint256 indexed jobId, address indexed user, uint256 indexed serviceId, uint256 providerId, uint64 queueDeadline, uint256 price, uint256 protocolFee, address providerPayoutWallet, address treasury, bytes32 requestId, bytes32 inputCommitment)",
] as const;

type ListenerHandle = {
  close: () => Promise<void>;
};

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

async function markJobFunded(
  onchainJobId: string,
  requestId: string,
  txHash: string | null,
  logger: FastifyBaseLogger
) {
  const job = await prisma.job.findFirst({
    where: { OR: [{ request_id: requestId }, { job_id: onchainJobId }] },
    select: { request_id: true, job_id: true, status: true, funded_at: true },
  });

  if (!job) {
    logger.warn(
      { jobId: onchainJobId, requestId, txHash },
      "JobCreated event received before any local request was registered"
    );
    return;
  }

  const localRequestId = job.request_id;
  const now = new Date();

  await prisma.$transaction(async (db) => {
    const existingOnchainJob = await db.job.findUnique({
      where: { job_id: onchainJobId },
      select: { request_id: true },
    });

    if (existingOnchainJob && existingOnchainJob.request_id !== localRequestId) {
      throw new Error("onchain_job_id_already_linked_to_another_request");
    }
    if (job.job_id && job.job_id !== onchainJobId) {
      throw new Error("local_request_already_linked_to_another_onchain_job_id");
    }

    if (job.status === "CREATED") {
      await db.job.update({
        where: { request_id: localRequestId },
        data: { job_id: onchainJobId, status: "FUNDED", funded_at: now },
      });
    } else if (job.status === "FUNDED" && !job.funded_at) {
      await db.job.update({
        where: { request_id: localRequestId },
        data: { job_id: onchainJobId, funded_at: now },
      });
    } else if (!job.job_id) {
      await db.job.update({
        where: { request_id: localRequestId },
        data: { job_id: onchainJobId },
      });
    }

    await db.escrow.updateMany({
      where: { request_id: localRequestId, escrow_status: "UNFUNDED" },
      data: {
        escrow_status: "LOCKED",
        ...(txHash ? { fund_tx_hash: txHash } : {}),
      },
    });

    if (txHash) {
      await db.escrow.updateMany({
        where: {
          request_id: localRequestId,
          fund_tx_hash: null,
          NOT: { escrow_status: "UNFUNDED" },
        },
        data: { fund_tx_hash: txHash },
      });
    }
  });

  logger.info(
    { requestId: localRequestId, onchainRequestId: requestId, jobId: onchainJobId, txHash },
    "Local job marked as funded from JobCreated event"
  );
}

export function startEscrowJobCreatedListener(logger: FastifyBaseLogger): ListenerHandle | null {
  if (env("ESCROW_JOB_CREATED_LISTENER_ENABLED") === "false") {
    logger.info("Escrow JobCreated listener disabled by ESCROW_JOB_CREATED_LISTENER_ENABLED=false");
    return null;
  }

  const rpcUrl = env("ARC_RPC_WS_URL");
  const escrowContractAddress = env("ESCROW_CONTRACT_ADDRESS");

  if (!rpcUrl || !escrowContractAddress) {
    logger.warn(
      "Escrow JobCreated listener not started: ARC_RPC_WS_URL and ESCROW_CONTRACT_ADDRESS must be set"
    );
    return null;
  }

  const provider = new WebSocketProvider(rpcUrl);
  const contract = new Contract(escrowContractAddress, ESCROW_ABI, provider);

  const onJobCreated = async (
    jobId: bigint,
    user: string,
    serviceId: bigint,
    providerId: bigint,
    queueDeadline: bigint,
    price: bigint,
    protocolFee: bigint,
    providerPayoutWallet: string,
    treasury: string,
    requestId: string,
    inputCommitment: string,
    event: ContractEventPayload
  ) => {
    const onchainJobId = jobId.toString();
    const txHash = event.log?.transactionHash ?? null;

    logger.info(
      {
        jobId: onchainJobId,
        user,
        serviceId: serviceId.toString(),
        providerId: providerId.toString(),
        queueDeadline: queueDeadline.toString(),
        price: price.toString(),
        protocolFee: protocolFee.toString(),
        providerPayoutWallet,
        treasury,
        requestId,
        inputCommitment,
        txHash,
      },
      "JobCreated event received from escrow contract"
    );

    try {
      await markJobFunded(onchainJobId, requestId, txHash, logger);
    } catch (err) {
      logger.error({ err, jobId: onchainJobId, requestId, txHash }, "Failed to process JobCreated event");
    }
  };

  provider.on("error", (err) => {
    logger.error({ err }, "Arc websocket provider error");
  });

  void contract.on("JobCreated", onJobCreated);

  logger.info({ rpcUrl, escrowContractAddress }, "Escrow JobCreated listener started");

  return {
    close: async () => {
      await contract.off("JobCreated", onJobCreated);
      await provider.destroy();
      logger.info("Escrow JobCreated listener stopped");
    },
  };
}
