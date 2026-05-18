import type { FastifyBaseLogger } from "fastify";
import { Contract, WebSocketProvider, type ContractEventPayload } from "ethers";
import { prisma } from "../lib/prisma.js";

const ESCROW_ABI = [
  "event JobCreated(uint256 indexed jobId, address indexed user, uint256 indexed serviceId, uint256 providerId, uint64 queueDeadline, uint256 price, uint256 protocolFee, address providerPayoutWallet, address treasury, bytes32 requestId, bytes32 inputCommitment)",
  "event JobStarted(uint256 indexed jobId, uint256 indexed providerId, uint64 startedAt, uint64 workDeadline, uint64 finalRefundDeadline)",
  "event JobSettledWithUserSignature(uint256 indexed jobId, bytes32 outputCommitment, address providerPayoutWallet, uint256 providerAmount, uint256 protocolFee)",
  "event JobSettledAfterReviewTimeout(uint256 indexed jobId, bytes32 outputCommitment, uint64 deliveredAt, address providerPayoutWallet, uint256 providerAmount, uint256 protocolFee)",
  "event JobRefundedWithNoDeliveryAttestation(uint256 indexed jobId, uint64 checkedAt, uint256 amount)",
  "event JobRefundedAfterQueueTimeout(uint256 indexed jobId, uint256 amount)",
  "event JobRefundedAfterFinalTimeout(uint256 indexed jobId, uint256 amount)",
] as const;

type ListenerHandle = {
  close: () => Promise<void>;
};

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function toDate(seconds: bigint): Date {
  return new Date(Number(seconds) * 1000);
}

async function markJobFunded(
  onchainJobId: string,
  requestId: string,
  queueDeadline: bigint,
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
        data: {
          job_id: onchainJobId,
          status: "FUNDED",
          funded_at: now,
          queue_deadline: toDate(queueDeadline),
        },
      });
    } else if (job.status === "FUNDED" && !job.funded_at) {
      await db.job.update({
        where: { request_id: localRequestId },
        data: {
          job_id: onchainJobId,
          funded_at: now,
          queue_deadline: toDate(queueDeadline),
        },
      });
    } else if (!job.job_id) {
      await db.job.update({
        where: { request_id: localRequestId },
        data: {
          job_id: onchainJobId,
          queue_deadline: toDate(queueDeadline),
        },
      });
    } else {
      await db.job.update({
        where: { request_id: localRequestId },
        data: { queue_deadline: toDate(queueDeadline) },
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

async function markJobStarted(
  onchainJobId: string,
  startedAt: bigint,
  workDeadline: bigint,
  finalRefundDeadline: bigint,
  txHash: string | null,
  logger: FastifyBaseLogger
) {
  const updated = await prisma.job.updateMany({
    where: {
      job_id: onchainJobId,
      status: { in: ["FUNDED", "RUNNING"] },
    },
    data: {
      status: "RUNNING",
      started_at: toDate(startedAt),
      work_deadline: toDate(workDeadline),
      final_refund_deadline: toDate(finalRefundDeadline),
    },
  });

  if (updated.count === 0) {
    logger.warn({ jobId: onchainJobId, txHash }, "JobStarted event did not match a startable local job");
    return;
  }

  logger.info({ jobId: onchainJobId, txHash }, "Local job marked as running from JobStarted event");
}

async function markJobSettled(
  onchainJobId: string,
  outputCommitment: string,
  deliveredAt: bigint | null,
  txHash: string | null,
  logger: FastifyBaseLogger
) {
  const now = new Date();
  const updated = await prisma.job.updateMany({
    where: {
      job_id: onchainJobId,
      status: { in: ["RUNNING", "SUBMITTED", "ACCEPTED", "DISPUTED"] },
    },
    data: {
      status: "SETTLED",
      output_hash: outputCommitment,
      ...(deliveredAt != null ? { delivered_at: toDate(deliveredAt), submitted_at: toDate(deliveredAt) } : {}),
      settled_at: now,
    },
  });

  if (updated.count === 0) {
    logger.warn({ jobId: onchainJobId, txHash }, "Settlement event did not match a settleable local job");
    return;
  }

  const job = await prisma.job.findUnique({ where: { job_id: onchainJobId }, select: { request_id: true } });
  if (job) {
    await prisma.escrow.updateMany({
      where: { request_id: job.request_id, escrow_status: { in: ["LOCKED", "DISPUTED"] } },
      data: {
        escrow_status: "RELEASED",
        ...(txHash ? { release_tx_hash: txHash } : {}),
      },
    });
  }

  logger.info({ jobId: onchainJobId, txHash }, "Local job marked as settled from escrow event");
}

async function markJobRefunded(
  onchainJobId: string,
  reason: string,
  txHash: string | null,
  logger: FastifyBaseLogger
) {
  const updated = await prisma.job.updateMany({
    where: {
      job_id: onchainJobId,
      status: { notIn: ["SETTLED", "REFUNDED"] },
    },
    data: {
      status: "REFUNDED",
      error_message: reason,
    },
  });

  if (updated.count === 0) {
    logger.warn({ jobId: onchainJobId, reason, txHash }, "Refund event did not match a refundable local job");
    return;
  }

  const job = await prisma.job.findUnique({ where: { job_id: onchainJobId }, select: { request_id: true } });
  if (job) {
    await prisma.escrow.updateMany({
      where: { request_id: job.request_id, escrow_status: { in: ["LOCKED", "DISPUTED"] } },
      data: {
        escrow_status: "REFUNDED",
        ...(txHash ? { refund_tx_hash: txHash } : {}),
      },
    });
  }

  logger.info({ jobId: onchainJobId, reason, txHash }, "Local job marked as refunded from escrow event");
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
      await markJobFunded(onchainJobId, requestId, queueDeadline, txHash, logger);
    } catch (err) {
      logger.error({ err, jobId: onchainJobId, requestId, txHash }, "Failed to process JobCreated event");
    }
  };

  const onJobStarted = async (
    jobId: bigint,
    providerId: bigint,
    startedAt: bigint,
    workDeadline: bigint,
    finalRefundDeadline: bigint,
    event: ContractEventPayload
  ) => {
    const onchainJobId = jobId.toString();
    const txHash = event.log?.transactionHash ?? null;
    logger.info(
      {
        jobId: onchainJobId,
        providerId: providerId.toString(),
        startedAt: startedAt.toString(),
        workDeadline: workDeadline.toString(),
        finalRefundDeadline: finalRefundDeadline.toString(),
        txHash,
      },
      "JobStarted event received from escrow contract"
    );

    try {
      await markJobStarted(onchainJobId, startedAt, workDeadline, finalRefundDeadline, txHash, logger);
    } catch (err) {
      logger.error({ err, jobId: onchainJobId, txHash }, "Failed to process JobStarted event");
    }
  };

  const onJobSettledWithUserSignature = async (
    jobId: bigint,
    outputCommitment: string,
    providerPayoutWallet: string,
    providerAmount: bigint,
    protocolFee: bigint,
    event: ContractEventPayload
  ) => {
    const onchainJobId = jobId.toString();
    const txHash = event.log?.transactionHash ?? null;
    logger.info(
      {
        jobId: onchainJobId,
        outputCommitment,
        providerPayoutWallet,
        providerAmount: providerAmount.toString(),
        protocolFee: protocolFee.toString(),
        txHash,
      },
      "JobSettledWithUserSignature event received from escrow contract"
    );

    try {
      await markJobSettled(onchainJobId, outputCommitment, null, txHash, logger);
    } catch (err) {
      logger.error({ err, jobId: onchainJobId, txHash }, "Failed to process settlement event");
    }
  };

  const onJobSettledAfterReviewTimeout = async (
    jobId: bigint,
    outputCommitment: string,
    deliveredAt: bigint,
    providerPayoutWallet: string,
    providerAmount: bigint,
    protocolFee: bigint,
    event: ContractEventPayload
  ) => {
    const onchainJobId = jobId.toString();
    const txHash = event.log?.transactionHash ?? null;
    logger.info(
      {
        jobId: onchainJobId,
        outputCommitment,
        deliveredAt: deliveredAt.toString(),
        providerPayoutWallet,
        providerAmount: providerAmount.toString(),
        protocolFee: protocolFee.toString(),
        txHash,
      },
      "JobSettledAfterReviewTimeout event received from escrow contract"
    );

    try {
      await markJobSettled(onchainJobId, outputCommitment, deliveredAt, txHash, logger);
    } catch (err) {
      logger.error({ err, jobId: onchainJobId, txHash }, "Failed to process timeout settlement event");
    }
  };

  const onJobRefundedWithNoDeliveryAttestation = async (
    jobId: bigint,
    checkedAt: bigint,
    amount: bigint,
    event: ContractEventPayload
  ) => {
    const onchainJobId = jobId.toString();
    const txHash = event.log?.transactionHash ?? null;
    logger.info(
      { jobId: onchainJobId, checkedAt: checkedAt.toString(), amount: amount.toString(), txHash },
      "JobRefundedWithNoDeliveryAttestation event received from escrow contract"
    );

    try {
      await markJobRefunded(onchainJobId, "no_delivery_attestation_refunded", txHash, logger);
    } catch (err) {
      logger.error({ err, jobId: onchainJobId, txHash }, "Failed to process no-delivery refund event");
    }
  };

  const onJobRefundedAfterQueueTimeout = async (
    jobId: bigint,
    amount: bigint,
    event: ContractEventPayload
  ) => {
    const onchainJobId = jobId.toString();
    const txHash = event.log?.transactionHash ?? null;
    logger.info(
      { jobId: onchainJobId, amount: amount.toString(), txHash },
      "JobRefundedAfterQueueTimeout event received from escrow contract"
    );

    try {
      await markJobRefunded(onchainJobId, "queue_timeout_refunded", txHash, logger);
    } catch (err) {
      logger.error({ err, jobId: onchainJobId, txHash }, "Failed to process queue refund event");
    }
  };

  const onJobRefundedAfterFinalTimeout = async (
    jobId: bigint,
    amount: bigint,
    event: ContractEventPayload
  ) => {
    const onchainJobId = jobId.toString();
    const txHash = event.log?.transactionHash ?? null;
    logger.info(
      { jobId: onchainJobId, amount: amount.toString(), txHash },
      "JobRefundedAfterFinalTimeout event received from escrow contract"
    );

    try {
      await markJobRefunded(onchainJobId, "final_timeout_refunded", txHash, logger);
    } catch (err) {
      logger.error({ err, jobId: onchainJobId, txHash }, "Failed to process final refund event");
    }
  };

  provider.on("error", (err) => {
    logger.error({ err }, "Arc websocket provider error");
  });

  void contract.on("JobCreated", onJobCreated);
  void contract.on("JobStarted", onJobStarted);
  void contract.on("JobSettledWithUserSignature", onJobSettledWithUserSignature);
  void contract.on("JobSettledAfterReviewTimeout", onJobSettledAfterReviewTimeout);
  void contract.on("JobRefundedWithNoDeliveryAttestation", onJobRefundedWithNoDeliveryAttestation);
  void contract.on("JobRefundedAfterQueueTimeout", onJobRefundedAfterQueueTimeout);
  void contract.on("JobRefundedAfterFinalTimeout", onJobRefundedAfterFinalTimeout);

  logger.info({ rpcUrl, escrowContractAddress }, "Escrow JobCreated listener started");

  return {
    close: async () => {
      await contract.off("JobCreated", onJobCreated);
      await contract.off("JobStarted", onJobStarted);
      await contract.off("JobSettledWithUserSignature", onJobSettledWithUserSignature);
      await contract.off("JobSettledAfterReviewTimeout", onJobSettledAfterReviewTimeout);
      await contract.off("JobRefundedWithNoDeliveryAttestation", onJobRefundedWithNoDeliveryAttestation);
      await contract.off("JobRefundedAfterQueueTimeout", onJobRefundedAfterQueueTimeout);
      await contract.off("JobRefundedAfterFinalTimeout", onJobRefundedAfterFinalTimeout);
      await provider.destroy();
      logger.info("Escrow JobCreated listener stopped");
    },
  };
}
