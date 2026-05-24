import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { JobStatus, type Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { serializeJob, serializeEscrow } from "../lib/serialize.js";
import { notFound, sendZodError, conflict, forbidden } from "../lib/http-errors.js";
import {
  buildJobAcceptance,
  buildStartJobAuthorization,
  CreateJobAuthorizationError,
  isBytes32,
  normalizeOutputCommitment,
  signDeliveryAttestation,
  signCreateJobAuthorization,
  signNoDeliveryAttestation,
} from "../lib/create-job-authorization.js";
import {
  relayRefundWithNoDeliveryAttestation,
  relaySettleAfterReviewTimeout,
  relaySettleWithUserSignature,
  relayStartJob,
} from "../lib/escrow-relayer.js";
import {
  buildCreateJobTransaction,
  buildRefundAfterFinalTimeoutTransaction,
  buildRefundAfterQueueTimeoutTransaction,
} from "../lib/escrow-transaction.js";
import { logProviderJobPayload } from "../lib/log-job-payload.js";
import { getProviderIdHeader, verifyProviderRequestHeaders } from "../lib/provider-request-auth.js";
import { isUint256String, uint256StringSchema } from "../lib/uint256.js";
import { requireUserAuth, type AuthenticatedUser } from "../lib/auth.js";
import { syncJobCreatedFromTransaction } from "../listeners/escrow-job-created.js";

const JOB_STATUS = [
  "CREATED", "FUNDED", "RUNNING", "SUBMITTED",
  "ACCEPTED", "SETTLED", "FAILED", "EXPIRED", "REFUNDED", "DISPUTED",
] as const;

const CAPACITY_JOB_STATUSES: JobStatus[] = [
  JobStatus.RUNNING,
];

const REVIEW_TIMEOUT_SETTLEMENT_JOB_STATUSES: JobStatus[] = [
  JobStatus.SUBMITTED,
  JobStatus.ACCEPTED,
];

const createSchema = z.object({
  job_id: z.string().min(1).optional(),
  request_id: z.string().refine(isBytes32, "request_id must be bytes32").optional(),
  user_wallet: z.string().min(1),
  provider_id: uint256StringSchema("provider_id"),
  input: z.unknown().optional(),
  input_hash: z.string().optional(),
  input_commitment: z.string().refine(isBytes32, "input_commitment must be bytes32").optional(),
  queue_timeout_seconds: z.number().int().min(60).optional(),
  authorization_expires_at: z.number().int().positive().optional(),
  authorization_expires_in_seconds: z.number().int().positive().optional(),
  work_deadline: z.string().datetime().optional(),
  review_deadline: z.string().datetime().optional(),
});

const authExpirySchema = z.object({
  expires_at: z.number().int().positive().optional(),
  expires_in_seconds: z.number().int().positive().optional(),
});

const providerSignatureSchema = authExpirySchema.extend({
  provider_signature: z.string().min(1),
});

const providerCancelSchema = authExpirySchema.extend({
  error_message: z.string().min(1).max(500).optional(),
});

const outputCommitmentSchema = authExpirySchema.extend({
  output: z.unknown().optional(),
  output_hash: z.string().optional(),
  output_commitment: z.string().refine(isBytes32, "output_commitment must be bytes32").optional(),
});

const deliveryAttestationSchema = outputCommitmentSchema;

const acceptanceSchema = outputCommitmentSchema.extend({
  expires_at: z.number().int().positive(),
  user_signature: z.string().min(1),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

const jobResponseSchema = z.object({
  request_id: z.string(),
  job_id: z.string().nullable(),
  user_wallet: z.string(),
  provider_request_id: z.string(),
  status: z.string(),
  input: z.unknown().nullable(),
  input_hash: z.string().nullable(),
  output: z.unknown().nullable(),
  output_hash: z.string().nullable(),
  error_message: z.string().nullable(),
  queue_deadline: z.string().nullable(),
  work_deadline: z.string().nullable(),
  review_deadline: z.string().nullable(),
  final_refund_deadline: z.string().nullable(),
  delivered_at: z.string().nullable(),
  delivery_attestation: z.unknown().nullable(),
  no_delivery_attestation: z.unknown().nullable(),
  no_delivery_attested_at: z.string().nullable(),
  funded_at: z.string().nullable(),
  started_at: z.string().nullable(),
  submitted_at: z.string().nullable(),
  accepted_at: z.string().nullable(),
  settled_at: z.string().nullable(),
  created_at: z.string(),
});

const preparedTransactionResponseSchema = z.object({
  to: z.string(),
  data: z.string(),
  value: z.literal("0"),
  from: z.string().optional(),
  chain_id: z.number().optional(),
});

const listQuerySchema = z.object({
  request_id: z.string().optional(),
  job_id: z.string().optional(),
  user_wallet: z.string().optional(),
  provider_request_id: z.string().refine(isBytes32, "provider_request_id must be bytes32").optional(),
  status: z.enum(JOB_STATUS).optional(),
});

const txHashSchema = z.object({
  tx_hash: z.string().refine((value) => /^0x[0-9a-fA-F]{64}$/.test(value), "tx_hash_must_be_32_byte_hex"),
});

function isStatus(status: JobStatus, statuses: readonly JobStatus[]): boolean {
  return statuses.includes(status);
}

function dateFromUnixSeconds(seconds: number): Date {
  return new Date(seconds * 1000);
}

function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function dateFromOptionalUnixSeconds(seconds: number | null): Date | undefined {
  return seconds == null ? undefined : dateFromUnixSeconds(seconds);
}

function secondsFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) return fallback;
  return value;
}

function sameWallet(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function authenticatedUser(req: FastifyRequest, reply: FastifyReply): AuthenticatedUser | null {
  if (!req.user) {
    reply.status(401).send({ error: "unauthorized" });
    return null;
  }
  return req.user;
}

function ensureUserOwnsJob(req: FastifyRequest, reply: FastifyReply, job: { user_wallet: string }): boolean {
  const user = authenticatedUser(req, reply);
  if (!user) return false;
  if (sameWallet(job.user_wallet, user.walletAddress)) return true;
  req.log.warn(
    { userId: user.id, walletAddress: user.walletAddress, jobUserWallet: job.user_wallet },
    "Authenticated user attempted to access a job owned by another wallet"
  );
  forbidden(reply, "job_wallet_mismatch");
  return false;
}

async function getJobWithProvider(id: string) {
  return prisma.job.findFirst({
    where: { OR: [{ request_id: id }, { job_id: id }] },
    include: { provider: true },
  });
}

async function getNextStartableJobForProvider(providerRequestId: string) {
  const jobs = await prisma.job.findMany({
    where: {
      provider_request_id: providerRequestId,
      status: JobStatus.FUNDED,
      job_id: { not: null },
      input_hash: { not: null },
      OR: [
        { queue_deadline: null },
        { queue_deadline: { gt: new Date() } },
      ],
    },
    include: { provider: true },
  });

  return jobs.reduce<(typeof jobs)[number] | null>((next, job) => {
    if (!job.job_id || !isUint256String(job.job_id)) return next;
    if (!next?.job_id) return job;
    return BigInt(job.job_id) < BigInt(next.job_id) ? job : next;
  }, null);
}

async function providerFromAuthHeader(providerId: string) {
  if (isBytes32(providerId)) {
    return prisma.provider.findUnique({ where: { request_id: providerId } });
  }
  if (isUint256String(providerId)) {
    return prisma.provider.findUnique({ where: { registry_provider_id: providerId } });
  }
  return null;
}

async function runningCapacityForProvider(providerRequestId: string) {
  return prisma.job.count({
    where: {
      provider_request_id: providerRequestId,
      status: { in: CAPACITY_JOB_STATUSES },
    },
  });
}

async function ensureStartable(job: Awaited<ReturnType<typeof getJobWithProvider>>) {
  if (!job) return "job_not_found";
  if (!job.job_id) return "job_not_funded_onchain";
  if (!job.input_hash) return "input_commitment_missing";
  if (job.status !== JobStatus.FUNDED) return `job_not_funded_status_${job.status}`;
  if (job.queue_deadline && job.queue_deadline.getTime() <= Date.now()) {
    return "queue_deadline_expired";
  }
  const activeJobs = await runningCapacityForProvider(job.provider_request_id);
  if (activeJobs >= job.provider.max_concurrent_jobs) return "provider_capacity_exceeded";
  return null;
}

function ensureOnchainJob(job: Awaited<ReturnType<typeof getJobWithProvider>>) {
  if (!job) throw new CreateJobAuthorizationError("job_not_found", 404);
  if (!job.job_id) throw new CreateJobAuthorizationError("job_not_funded_onchain", 409);
  if (!job.input_hash) throw new CreateJobAuthorizationError("input_commitment_missing", 409);
  if (!job.provider.registry_provider_id) {
    throw new CreateJobAuthorizationError("provider_registry_id_missing", 409);
  }
  return {
    jobId: job.job_id,
    providerId: job.provider.registry_provider_id,
    inputCommitment: job.input_hash,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function validateJsonSchemaShape(value: unknown, schema: unknown, path = "output"): string | null {
  if (!isRecord(schema)) return null;

  const expectedType = schema.type;
  if (typeof expectedType === "string") {
    const actualType = jsonType(value);
    const valid =
      expectedType === actualType ||
      (expectedType === "number" && actualType === "integer");
    if (!valid) return `${path}_must_be_${expectedType}`;
  }

  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required)) return `${path}_schema_required_must_be_array`;
    if (!isRecord(value)) return `${path}_must_be_object`;
    const missing = schema.required.find((field) => typeof field === "string" && !(field in value));
    if (missing) return `${path}.${String(missing)}_is_required`;
  }

  if (isRecord(schema.properties) && isRecord(value)) {
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (key in value) {
        const error = validateJsonSchemaShape(value[key], childSchema, `${path}.${key}`);
        if (error) return error;
      }
    }
  }

  if (schema.items !== undefined && Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const error = validateJsonSchemaShape(value[i], schema.items, `${path}[${i}]`);
      if (error) return error;
    }
  }

  return null;
}

function buildDeliveryAttestationRecord(attestation: Awaited<ReturnType<typeof signDeliveryAttestation>>) {
  return {
    delivered_at: attestation.delivered_at,
    expires_at: attestation.expires_at,
    delivery_attester_signature: attestation.delivery_attester_signature,
    settle_after_review_timeout_args: attestation.settle_after_review_timeout_args,
  };
}

function buildNoDeliveryAttestationRecord(attestation: Awaited<ReturnType<typeof signNoDeliveryAttestation>>) {
  return {
    checked_at: attestation.checked_at,
    expires_at: attestation.expires_at,
    no_delivery_attester_signature: attestation.no_delivery_attester_signature,
    refund_with_no_delivery_attestation_args: attestation.refund_with_no_delivery_attestation_args,
  };
}

type SettleAfterReviewTimeoutArgs = {
  job_id: string;
  output_commitment: string;
  delivered_at: number;
  expires_at: number;
  delivery_attester_signature: string;
};

function stringField(record: Record<string, unknown>, fieldName: string): string | null {
  const value = record[fieldName];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function positiveIntegerField(record: Record<string, unknown>, fieldName: string): number | null {
  const value = record[fieldName];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseSettleAfterReviewTimeoutArgs(value: unknown): SettleAfterReviewTimeoutArgs | null {
  if (!isRecord(value)) return null;
  const maybeArgs = isRecord(value.settle_after_review_timeout_args)
    ? value.settle_after_review_timeout_args
    : value;

  const jobId = stringField(maybeArgs, "job_id");
  const outputCommitment = stringField(maybeArgs, "output_commitment");
  const deliveredAt = positiveIntegerField(maybeArgs, "delivered_at");
  const expiresAt = positiveIntegerField(maybeArgs, "expires_at");
  const deliveryAttesterSignature = stringField(maybeArgs, "delivery_attester_signature");

  if (!jobId || !outputCommitment || !deliveredAt || !expiresAt || !deliveryAttesterSignature) {
    return null;
  }

  return {
    job_id: jobId,
    output_commitment: outputCommitment,
    delivered_at: deliveredAt,
    expires_at: expiresAt,
    delivery_attester_signature: deliveryAttesterSignature,
  };
}

async function settleAfterReviewTimeoutArgsForJob(
  job: NonNullable<Awaited<ReturnType<typeof getJobWithProvider>>>,
  logger?: FastifyBaseLogger
): Promise<SettleAfterReviewTimeoutArgs | null> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const minTtlSeconds = secondsFromEnv("REVIEW_TIMEOUT_SETTLEMENT_AUTH_MIN_TTL_SECONDS", 120);
  const storedArgs = parseSettleAfterReviewTimeoutArgs(job.delivery_attestation);
  if (storedArgs && storedArgs.expires_at > nowSeconds + minTtlSeconds) {
    return storedArgs;
  }

  if (!job.output_hash) {
    throw new CreateJobAuthorizationError("output_commitment_missing_for_review_timeout_settlement", 409);
  }
  if (!job.delivered_at) {
    throw new CreateJobAuthorizationError("delivered_at_missing_for_review_timeout_settlement", 409);
  }

  const attestation = await signDeliveryAttestation({
    ...ensureOnchainJob(job),
    outputCommitment: job.output_hash,
    deliveredAt: unixSeconds(job.delivered_at),
    expiresInSeconds: secondsFromEnv("REVIEW_TIMEOUT_SETTLEMENT_AUTH_EXPIRES_IN_SECONDS", 3600),
  });
  const attestationRecord = buildDeliveryAttestationRecord(attestation);
  const updated = await prisma.job.updateMany({
    where: {
      request_id: job.request_id,
      status: { in: REVIEW_TIMEOUT_SETTLEMENT_JOB_STATUSES },
      settled_at: null,
      review_deadline: { lt: new Date() },
    },
    data: {
      delivery_attestation: attestationRecord as Prisma.InputJsonValue,
    },
  });

  if (updated.count === 0) return null;

  logger?.info(
    { requestId: job.request_id, jobId: job.job_id },
    "Refreshed DeliveryAttestation for review timeout settlement"
  );

  return attestation.settle_after_review_timeout_args;
}

async function settleJobAfterReviewTimeout(
  job: NonNullable<Awaited<ReturnType<typeof getJobWithProvider>>>,
  logger?: FastifyBaseLogger
) {
  if (!job.review_deadline || job.review_deadline.getTime() >= Date.now()) return null;
  if (!isStatus(job.status, REVIEW_TIMEOUT_SETTLEMENT_JOB_STATUSES)) return null;

  const settleArgs = await settleAfterReviewTimeoutArgsForJob(job, logger);
  if (!settleArgs) return null;

  const relayed = await relaySettleAfterReviewTimeout({
    jobId: settleArgs.job_id,
    outputCommitment: settleArgs.output_commitment,
    deliveredAt: settleArgs.delivered_at,
    expiresAt: settleArgs.expires_at,
    deliveryAttesterSignature: settleArgs.delivery_attester_signature,
  });

  const settledAt = relayed.settled_at != null ? dateFromUnixSeconds(relayed.settled_at) : new Date();
  const deliveredAt = dateFromUnixSeconds(relayed.delivered_at ?? settleArgs.delivered_at);
  const updated = await prisma.job.updateMany({
    where: {
      request_id: job.request_id,
      status: { in: REVIEW_TIMEOUT_SETTLEMENT_JOB_STATUSES },
      settled_at: null,
    },
    data: {
      status: JobStatus.SETTLED,
      output_hash: settleArgs.output_commitment,
      delivered_at: deliveredAt,
      submitted_at: job.submitted_at ?? deliveredAt,
      settled_at: settledAt,
    },
  });

  await prisma.escrow.updateMany({
    where: { request_id: job.request_id, escrow_status: { in: ["LOCKED", "DISPUTED"] } },
    data: {
      escrow_status: "RELEASED",
      release_tx_hash: relayed.transaction_hash,
    },
  });

  if (updated.count === 0) {
    logger?.warn(
      { requestId: job.request_id, jobId: job.job_id, transactionHash: relayed.transaction_hash },
      "Review timeout settlement relayed but local job was already updated"
    );
  }

  return {
    settle_after_review_timeout_args: settleArgs,
    transaction_hash: relayed.transaction_hash,
    relayer_address: relayed.relayer_address,
    block_number: relayed.block_number,
    gas_used: relayed.gas_used,
    provider_payout_wallet: relayed.provider_payout_wallet,
    provider_amount: relayed.provider_amount,
    protocol_fee: relayed.protocol_fee,
  };
}

async function issueNoDeliveryAttestation(
  job: NonNullable<Awaited<ReturnType<typeof getJobWithProvider>>>,
  checkedAt = Math.floor(Date.now() / 1000)
) {
  if (!isStatus(job.status, [JobStatus.RUNNING, JobStatus.FAILED]) || job.delivered_at || !job.work_deadline) {
    return null;
  }
  if (checkedAt <= unixSeconds(job.work_deadline)) return null;

  const attestation = await signNoDeliveryAttestation({
    ...ensureOnchainJob(job),
    checkedAt,
  });
  const relayed = await relayRefundWithNoDeliveryAttestation({
    jobId: attestation.refund_with_no_delivery_attestation_args.job_id,
    checkedAt: attestation.refund_with_no_delivery_attestation_args.checked_at,
    expiresAt: attestation.refund_with_no_delivery_attestation_args.expires_at,
    noDeliveryAttesterSignature:
      attestation.refund_with_no_delivery_attestation_args.no_delivery_attester_signature,
  });
  const attestationRecord = buildNoDeliveryAttestationRecord(attestation);
  const checkedAtDate = dateFromUnixSeconds(attestation.checked_at);
  const updated = await prisma.job.updateMany({
    where: {
      request_id: job.request_id,
      status: { in: [JobStatus.RUNNING, JobStatus.FAILED] },
      delivered_at: null,
      work_deadline: { lt: checkedAtDate },
    },
    data: {
      status: JobStatus.REFUNDED,
      error_message: job.error_message ?? "no_delivery_attested",
      no_delivery_attestation: attestationRecord as Prisma.InputJsonValue,
      no_delivery_attested_at: checkedAtDate,
    },
  });

  if (updated.count === 0) return null;

  await prisma.escrow.updateMany({
    where: { request_id: job.request_id, escrow_status: { in: ["LOCKED", "DISPUTED"] } },
    data: {
      escrow_status: "REFUNDED",
      refund_tx_hash: relayed.transaction_hash,
    },
  });

  const updatedJob = await prisma.job.findUniqueOrThrow({
    where: { request_id: job.request_id },
  });

  return {
    job: updatedJob,
    refund_with_no_delivery_attestation_args: attestation.refund_with_no_delivery_attestation_args,
    transaction_hash: relayed.transaction_hash,
    relayer_address: relayed.relayer_address,
    block_number: relayed.block_number,
    gas_used: relayed.gas_used,
    refund_amount: relayed.amount,
  };
}

export async function emitExpiredNoDeliveryAttestations(logger?: FastifyBaseLogger) {
  const expiredJobs = await prisma.job.findMany({
    where: {
      status: { in: [JobStatus.RUNNING, JobStatus.FAILED] },
      delivered_at: null,
      work_deadline: { lt: new Date() },
    },
    include: { provider: true },
    orderBy: { work_deadline: "asc" },
    take: 50,
  });

  let emitted = 0;
  for (const job of expiredJobs) {
    try {
      const result = await issueNoDeliveryAttestation(job);
      if (result) emitted += 1;
    } catch (err) {
      logger?.error({ err, requestId: job.request_id, jobId: job.job_id }, "Failed to emit NoDeliveryAttestation");
    }
  }

  if (emitted > 0) {
    logger?.info({ emitted }, "Expired running jobs were refunded with NoDeliveryAttestations");
  }

  return { scanned: expiredJobs.length, emitted };
}

export function startNoDeliveryAttestationWorker(logger: FastifyBaseLogger) {
  if (process.env.NO_DELIVERY_ATTESTATION_WORKER_ENABLED === "false") {
    logger.info("NoDeliveryAttestation worker disabled by NO_DELIVERY_ATTESTATION_WORKER_ENABLED=false");
    return null;
  }

  const intervalMs = secondsFromEnv("NO_DELIVERY_ATTESTATION_WORKER_INTERVAL_SECONDS", 60) * 1000;
  const run = () => {
    void emitExpiredNoDeliveryAttestations(logger).catch((err) => {
      logger.error({ err }, "NoDeliveryAttestation worker failed");
    });
  };

  const timer = setInterval(run, intervalMs);
  timer.unref();
  run();

  logger.info({ intervalMs }, "NoDeliveryAttestation worker started");

  return {
    close: async () => {
      clearInterval(timer);
      logger.info("NoDeliveryAttestation worker stopped");
    },
  };
}

export async function settleExpiredReviewTimeouts(logger?: FastifyBaseLogger) {
  const expiredJobs = await prisma.job.findMany({
    where: {
      status: { in: REVIEW_TIMEOUT_SETTLEMENT_JOB_STATUSES },
      settled_at: null,
      review_deadline: { lt: new Date() },
    },
    include: { provider: true },
    orderBy: { review_deadline: "asc" },
    take: secondsFromEnv("REVIEW_TIMEOUT_SETTLEMENT_WORKER_BATCH_SIZE", 25),
  });

  let settled = 0;
  let skipped = 0;
  let failed = 0;
  for (const job of expiredJobs) {
    try {
      const result = await settleJobAfterReviewTimeout(job, logger);
      if (result) {
        settled += 1;
        logger?.info(
          {
            requestId: job.request_id,
            jobId: job.job_id,
            transactionHash: result.transaction_hash,
          },
          "Review timeout settlement relayed"
        );
      } else {
        skipped += 1;
      }
    } catch (err) {
      failed += 1;
      logger?.error(
        { err, requestId: job.request_id, jobId: job.job_id },
        "Failed to settle job after review timeout"
      );
    }
  }

  if (settled > 0 || failed > 0) {
    logger?.info({ scanned: expiredJobs.length, settled, skipped, failed }, "Review timeout settlement scan finished");
  }

  return { scanned: expiredJobs.length, settled, skipped, failed };
}

export function startReviewTimeoutSettlementWorker(logger: FastifyBaseLogger) {
  if (process.env.REVIEW_TIMEOUT_SETTLEMENT_WORKER_ENABLED === "false") {
    logger.info("Review timeout settlement worker disabled by REVIEW_TIMEOUT_SETTLEMENT_WORKER_ENABLED=false");
    return null;
  }

  const intervalMs = secondsFromEnv("REVIEW_TIMEOUT_SETTLEMENT_WORKER_INTERVAL_SECONDS", 60) * 1000;
  let running = false;
  const run = () => {
    if (running) {
      logger.warn("Review timeout settlement worker skipped overlapping run");
      return;
    }

    running = true;
    void settleExpiredReviewTimeouts(logger)
      .catch((err) => {
        logger.error({ err }, "Review timeout settlement worker failed");
      })
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(run, intervalMs);
  timer.unref();
  run();

  logger.info({ intervalMs }, "Review timeout settlement worker started");

  return {
    close: async () => {
      clearInterval(timer);
      logger.info("Review timeout settlement worker stopped");
    },
  };
}

export async function jobsRoutes(app: FastifyInstance) {
  app.get("/jobs", {
    preHandler: requireUserAuth,
    schema: {
      tags: ["Jobs"],
      summary: "List jobs with optional filters",
      querystring: listQuerySchema,
      response: {
        200: z.array(jobResponseSchema),
        401: z.object({ error: z.string() }),
        403: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const query = listQuerySchema.safeParse(req.query);
    if (!query.success) return sendZodError(reply, query.error);
    const user = authenticatedUser(req, reply);
    if (!user) return;
    if (query.data.user_wallet && !sameWallet(query.data.user_wallet, user.walletAddress)) {
      return forbidden(reply, "user_wallet_mismatch");
    }
    const where = {
      user_wallet: { equals: user.walletAddress, mode: "insensitive" as const },
      ...(query.data.request_id ? { request_id: query.data.request_id } : {}),
      ...(query.data.job_id ? { job_id: query.data.job_id } : {}),
      ...(query.data.provider_request_id
        ? { provider_request_id: query.data.provider_request_id }
        : {}),
      ...(query.data.status ? { status: query.data.status } : {}),
    };
    const jobs = await prisma.job.findMany({
      where,
      orderBy: { created_at: "desc" },
    });
    const serialized = jobs.map(serializeJob);
    req.log.info(
      { userId: user.id, walletAddress: user.walletAddress, filters: query.data, count: serialized.length },
      "Authenticated user listed jobs"
    );
    for (const job of serialized) {
      logProviderJobPayload(req.log, "jobs_list", {
        request_id: job.request_id,
        job_id: job.job_id,
        status: job.status,
        provider_request_id: job.provider_request_id,
        input: job.input,
        input_hash: job.input_hash,
      }, { query: query.data });
    }
    return reply.send(serialized);
  });

  app.get<{ Params: { id: string } }>("/jobs/:id", {
    preHandler: requireUserAuth,
    schema: {
      tags: ["Jobs"],
      summary: "Get a job by request_id or job_id (includes escrow and provider info)",
      params: idParamsSchema,
      response: {
        200: jobResponseSchema.extend({
          escrow: z.unknown().nullable(),
          provider: z.object({
            request_id: z.string(),
            registry_provider_id: z.string().nullable(),
            name: z.string(),
            price_usdc: z.string(),
          }),
        }),
        401: z.object({ error: z.string() }),
        403: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const job = await prisma.job.findFirst({
      where: { OR: [{ request_id: req.params.id }, { job_id: req.params.id }] },
      include: { escrow: true, provider: true },
    });
    if (!job) return notFound(reply);
    if (ensureUserOwnsJob(req, reply, job) !== true) return;
    const body = {
      ...serializeJob(job),
      escrow: job.escrow ? serializeEscrow(job.escrow) : null,
      provider: {
        request_id: job.provider.request_id,
        registry_provider_id: job.provider.registry_provider_id,
        name: job.provider.name,
        price_usdc: job.provider.price_usdc.toString(),
      },
    };
    logProviderJobPayload(req.log, "jobs_get", {
      request_id: body.request_id,
      job_id: body.job_id,
      status: body.status,
      provider_request_id: body.provider_request_id,
      input: body.input,
      input_hash: body.input_hash,
    }, { user_id: req.user?.id, wallet_address: req.user?.walletAddress });
    return reply.send(body);
  });

  app.post("/jobs", {
    preHandler: requireUserAuth,
    schema: {
      tags: ["Jobs"],
      summary: "Create a job and generate on-chain creation arguments",
      body: createSchema,
      response: {
        201: preparedTransactionResponseSchema,
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        401: z.object({ error: z.string() }),
        403: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const user = authenticatedUser(req, reply);
    if (!user) return;
    if (!sameWallet(parsed.data.user_wallet, user.walletAddress)) {
      return forbidden(reply, "user_wallet_mismatch");
    }
    const provider = await prisma.provider.findUnique({
      where: { registry_provider_id: parsed.data.provider_id },
    });
    if (!provider) return notFound(reply, "provider_not_found");
    if (!provider.registry_provider_id) {
      return reply.status(400).send({ error: "provider_registry_id_missing" });
    }

    if (parsed.data.request_id) {
      const existing = await prisma.job.findUnique({
        where: { request_id: parsed.data.request_id },
      });
      if (existing) return conflict(reply, "request_id_already_exists");
    }

    try {
      const authorization = await signCreateJobAuthorization({
        userWallet: user.walletAddress,
        providerId: provider.registry_provider_id,
        priceUsdc: provider.price_usdc.toString(),
        workTimeoutSeconds: provider.timeout_seconds,
        requestId: parsed.data.request_id,
        inputCommitment: parsed.data.input_commitment,
        inputHash: parsed.data.input_hash,
        inputJson: parsed.data.input,
        queueTimeoutSeconds: parsed.data.queue_timeout_seconds,
        expiresAt: parsed.data.authorization_expires_at,
        expiresInSeconds: parsed.data.authorization_expires_in_seconds,
      });

      await prisma.job.create({
        data: {
          request_id: authorization.request_id,
          user_wallet: authorization.user_wallet,
          provider_request_id: provider.request_id,
          input: parsed.data.input === undefined ? undefined : (parsed.data.input as Prisma.InputJsonValue),
          input_hash: authorization.input_commitment,
          work_deadline: parsed.data.work_deadline
            ? new Date(parsed.data.work_deadline)
            : undefined,
          review_deadline: parsed.data.review_deadline
            ? new Date(parsed.data.review_deadline)
            : undefined,
        },
      });

      req.log.info(
        {
          userId: user.id,
          walletAddress: user.walletAddress,
          requestId: authorization.request_id,
          providerRequestId: provider.request_id,
        },
        "Authenticated user created job"
      );

      return reply.status(201).send(buildCreateJobTransaction({
        providerId: authorization.provider_id,
        requestId: authorization.request_id,
        inputCommitment: authorization.input_commitment,
        queueTimeoutSeconds: authorization.queue_timeout_seconds,
        expiresAt: authorization.expires_at,
        deliveryAttesterSignature: authorization.delivery_attester_signature,
        userWallet: authorization.user_wallet,
      }));
    } catch (err) {
      if (err instanceof CreateJobAuthorizationError) {
        return reply.status(err.statusCode as 400 | 500).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>("/jobs/:id/sync-funding", {
    preHandler: requireUserAuth,
    schema: {
      tags: ["Jobs"],
      summary: "Force-sync a local job from a JobCreated transaction if the listener missed it",
      params: idParamsSchema,
      body: txHashSchema,
      response: {
        200: jobResponseSchema.extend({
          synced_events: z.array(z.object({
            job_id: z.string(),
            request_id: z.string(),
            queue_deadline: z.string(),
          })),
        }),
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        401: z.object({ error: z.string() }),
        403: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = txHashSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);

    const job = await getJobWithProvider(req.params.id);
    if (job && ensureUserOwnsJob(req, reply, job) !== true) return;

    try {
      const syncedEvents = await syncJobCreatedFromTransaction(parsed.data.tx_hash, req.log);
      const matchedEvent = syncedEvents.find((event) =>
        event.request_id.toLowerCase() === req.params.id.toLowerCase() ||
        event.job_id === req.params.id ||
        (job
          ? event.request_id.toLowerCase() === job.request_id.toLowerCase() ||
            event.job_id === job.job_id
          : false)
      );
      if (!matchedEvent) return conflict(reply, "job_created_event_does_not_match_job");

      const updated = await prisma.job.findFirst({
        where: {
          OR: [
            { request_id: matchedEvent.request_id },
            { job_id: matchedEvent.job_id },
          ],
        },
      });
      if (!updated) return notFound(reply);
      if (ensureUserOwnsJob(req, reply, updated) !== true) return;

      return reply.send({
        ...serializeJob(updated),
        synced_events: syncedEvents,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "sync_funding_failed";
      const status = message.includes("missing_env") ? 500 : message.includes("not_found") ? 404 : 409;
      return reply.status(status as 404 | 409 | 500).send({ error: message });
    }
  });

  app.post("/jobs/start-next-job-request", {
    schema: {
      tags: ["Jobs"],
      summary: "Build the EIP-712 payload the provider signs before starting its next job",
      body: authExpirySchema,
      response: {
        200: z.object({
          typed_data: z.unknown(),
          start_job_args: z.object({
            job_id: z.string(),
            expires_at: z.number(),
          }),
        }),
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        401: z.object({ error: z.string() }),
        403: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = authExpirySchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const providerId = getProviderIdHeader(req);
    if (!providerId) {
      return reply.status(401).send({ error: "missing_header_x-provider-id" });
    }
    if (!isBytes32(providerId) && !isUint256String(providerId)) {
      return reply.status(400).send({ error: "provider_id_invalid" });
    }
    const provider = await providerFromAuthHeader(providerId);
    if (!provider) return notFound(reply, "provider_not_found");
    const auth = await verifyProviderRequestHeaders(req, reply, provider);
    if (!auth.ok) return auth.reply;
    const job = await getNextStartableJobForProvider(provider.request_id);
    if (!job) return notFound(reply, "next_job_not_found");
    const notStartable = await ensureStartable(job);
    if (notStartable) return conflict(reply, notStartable);

    try {
      return reply.send(buildStartJobAuthorization({
        ...ensureOnchainJob(job),
        expiresAt: parsed.data.expires_at,
        expiresInSeconds: parsed.data.expires_in_seconds,
      }));
    } catch (err) {
      if (err instanceof CreateJobAuthorizationError) {
        return reply.status(err.statusCode as 400 | 404 | 409 | 500).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>("/jobs/:id/start-job", {
    schema: {
      tags: ["Jobs"],
      summary: "Relay AgentHubEscrow.startJob after provider signed StartJobAuthorization",
      params: idParamsSchema,
      body: providerSignatureSchema,
      response: {
        200: z.object({
          input: z.unknown().nullable(),
          transaction_hash: z.string(),
          relayer_address: z.string(),
          block_number: z.number().nullable(),
          gas_used: z.string().nullable(),
          started_at: z.number().nullable(),
          work_deadline: z.number().nullable(),
          final_refund_deadline: z.number().nullable(),
        }),
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        401: z.object({ error: z.string() }),
        403: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = providerSignatureSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const job = await getJobWithProvider(req.params.id);
    if (!job) return notFound(reply);
    const auth = await verifyProviderRequestHeaders(req, reply, job.provider);
    if (!auth.ok) return auth.reply;
    const notStartable = await ensureStartable(job);
    if (notStartable) return conflict(reply, notStartable);

    try {
      const authorization = buildStartJobAuthorization({
        ...ensureOnchainJob(job),
        expiresAt: parsed.data.expires_at,
        expiresInSeconds: parsed.data.expires_in_seconds,
      });
      const relayed = await relayStartJob({
        jobId: authorization.start_job_args.job_id,
        expiresAt: authorization.start_job_args.expires_at,
        providerSignature: parsed.data.provider_signature,
      });

      if (relayed.started_at != null) {
        await prisma.job.updateMany({
          where: {
            request_id: job!.request_id,
            status: { in: [JobStatus.FUNDED, JobStatus.RUNNING] },
          },
          data: {
            status: JobStatus.RUNNING,
            started_at: dateFromUnixSeconds(relayed.started_at),
            work_deadline: dateFromOptionalUnixSeconds(relayed.work_deadline),
            final_refund_deadline: dateFromOptionalUnixSeconds(relayed.final_refund_deadline),
          },
        });
      }

      const responseBody = {
        input: job!.input,
        transaction_hash: relayed.transaction_hash,
        relayer_address: relayed.relayer_address,
        block_number: relayed.block_number,
        gas_used: relayed.gas_used,
        started_at: relayed.started_at,
        work_deadline: relayed.work_deadline,
        final_refund_deadline: relayed.final_refund_deadline,
      };
      logProviderJobPayload(req.log, "start_job_response", {
        request_id: job!.request_id,
        job_id: job!.job_id,
        status: job!.status,
        provider_request_id: job!.provider_request_id,
        input: job!.input,
        input_hash: job!.input_hash,
      }, {
        transaction_hash: responseBody.transaction_hash,
        relayer_address: responseBody.relayer_address,
      });
      return reply.send(responseBody);
    } catch (err) {
      if (err instanceof CreateJobAuthorizationError) {
        return reply.status(err.statusCode as 400 | 404 | 409 | 500).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>("/jobs/:id/job-finish", {
    schema: {
      tags: ["Jobs"],
      summary: "Finish a running job, validate provider output, and return DeliveryAttestation",
      params: idParamsSchema,
      body: deliveryAttestationSchema,
      response: {
        200: jobResponseSchema.extend({
          delivery_attestation: z.object({
            job_id: z.string(),
            output_commitment: z.string(),
            delivered_at: z.number(),
            expires_at: z.number(),
            delivery_attester_signature: z.string(),
          }),
          settle_after_review_timeout_args: z.object({
            job_id: z.string(),
            output_commitment: z.string(),
            delivered_at: z.number(),
            expires_at: z.number(),
            delivery_attester_signature: z.string(),
          }),
        }),
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        401: z.object({ error: z.string() }),
        403: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = deliveryAttestationSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const job = await getJobWithProvider(req.params.id);
    if (!job) return notFound(reply);
    const auth = await verifyProviderRequestHeaders(req, reply, job.provider);
    if (!auth.ok) return auth.reply;
    if (job.status !== JobStatus.RUNNING) {
      return conflict(reply, `job_not_running_status_${job.status}`);
    }

    try {
      if (job.provider.output_schema && parsed.data.output === undefined) {
        return reply.status(400).send({ error: "output_required_for_schema_validation" });
      }
      const schemaError = validateJsonSchemaShape(parsed.data.output, job.provider.output_schema);
      if (schemaError) return reply.status(400).send({ error: schemaError });

      const deliveredAt = Math.floor(Date.now() / 1000);
      if (job.started_at && deliveredAt < unixSeconds(job.started_at)) {
        return conflict(reply, "delivered_before_start");
      }
      if (job.work_deadline && deliveredAt > unixSeconds(job.work_deadline)) {
        return conflict(reply, "delivered_after_work_deadline");
      }
      const outputCommitment = normalizeOutputCommitment({
        outputCommitment: parsed.data.output_commitment,
        outputHash: parsed.data.output_hash,
        outputJson: parsed.data.output,
      });
      const attestation = await signDeliveryAttestation({
        ...ensureOnchainJob(job),
        outputCommitment,
        deliveredAt,
        expiresAt: parsed.data.expires_at,
        expiresInSeconds: parsed.data.expires_in_seconds,
      });
      const deliveredAtDate = dateFromUnixSeconds(attestation.delivered_at);
      const reviewTimeoutSeconds = secondsFromEnv("REVIEW_TIMEOUT_SECONDS", 3600);
      const attestationRecord = buildDeliveryAttestationRecord(attestation);
      const updatedCount = await prisma.job.updateMany({
        where: {
          request_id: job.request_id,
          status: JobStatus.RUNNING,
          delivered_at: null,
        },
        data: {
          status: JobStatus.SUBMITTED,
          output: parsed.data.output === undefined ? undefined : (parsed.data.output as Prisma.InputJsonValue),
          output_hash: outputCommitment,
          submitted_at: deliveredAtDate,
          delivered_at: deliveredAtDate,
          review_deadline: new Date(deliveredAtDate.getTime() + reviewTimeoutSeconds * 1000),
          delivery_attestation: attestationRecord as Prisma.InputJsonValue,
        },
      });
      if (updatedCount.count === 0) return conflict(reply, "job_already_finished");
      const updated = await prisma.job.findUniqueOrThrow({
        where: { request_id: job.request_id },
      });
      return reply.send({
        ...serializeJob(updated),
        delivery_attestation: attestation.settle_after_review_timeout_args,
        settle_after_review_timeout_args: attestation.settle_after_review_timeout_args,
      });
    } catch (err) {
      if (err instanceof CreateJobAuthorizationError) {
        return reply.status(err.statusCode as 400 | 404 | 409 | 500).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>("/jobs/:id/provider-cancel", {
    schema: {
      tags: ["Jobs"],
      summary: "Cancel a running job as the provider; relay refund when the contract allows it",
      params: idParamsSchema,
      body: providerCancelSchema,
      response: {
        200: jobResponseSchema.extend({
          refund_with_no_delivery_attestation_args: z.object({
            job_id: z.string(),
            checked_at: z.number(),
            expires_at: z.number(),
            no_delivery_attester_signature: z.string(),
          }).nullable(),
          refund_deferred_until: z.string().nullable(),
          transaction_hash: z.string().nullable(),
          relayer_address: z.string().nullable(),
          block_number: z.number().nullable(),
          gas_used: z.string().nullable(),
          refund_amount: z.string().nullable(),
        }),
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        401: z.object({ error: z.string() }),
        403: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = providerCancelSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);

    const job = await getJobWithProvider(req.params.id);
    if (!job) return notFound(reply);
    const auth = await verifyProviderRequestHeaders(req, reply, job.provider);
    if (!auth.ok) return auth.reply;
    if (!isStatus(job.status, [JobStatus.RUNNING, JobStatus.FAILED])) {
      return conflict(reply, `job_not_running_status_${job.status}`);
    }
    if (job.delivered_at) return conflict(reply, "job_already_delivered");

    if (job.status === JobStatus.FAILED) {
      if (job.error_message !== (parsed.data.error_message ?? "provider_cancelled")) {
        return conflict(reply, `job_not_running_status_${job.status}`);
      }
      if (!job.work_deadline || Date.now() <= job.work_deadline.getTime()) {
        return reply.send({
          ...serializeJob(job),
          refund_with_no_delivery_attestation_args: null,
          refund_deferred_until: job.work_deadline ? job.work_deadline.toISOString() : null,
          transaction_hash: null,
          relayer_address: null,
          block_number: null,
          gas_used: null,
          refund_amount: null,
        });
      }
    }

    try {
      if (job.work_deadline && Date.now() <= job.work_deadline.getTime()) {
        await prisma.job.updateMany({
          where: {
            request_id: job.request_id,
            status: JobStatus.RUNNING,
            delivered_at: null,
          },
          data: {
            status: JobStatus.FAILED,
            error_message: parsed.data.error_message ?? "provider_cancelled",
          },
        });
        const updated = await prisma.job.findUniqueOrThrow({
          where: { request_id: job.request_id },
        });
        return reply.send({
          ...serializeJob(updated),
          refund_with_no_delivery_attestation_args: null,
          refund_deferred_until: job.work_deadline.toISOString(),
          transaction_hash: null,
          relayer_address: null,
          block_number: null,
          gas_used: null,
          refund_amount: null,
        });
      }

      const checkedAt = Math.floor(Date.now() / 1000);
      const attestation = await signNoDeliveryAttestation({
        ...ensureOnchainJob(job),
        checkedAt,
        expiresAt: parsed.data.expires_at,
        expiresInSeconds: parsed.data.expires_in_seconds,
      });
      const relayed = await relayRefundWithNoDeliveryAttestation({
        jobId: attestation.refund_with_no_delivery_attestation_args.job_id,
        checkedAt: attestation.refund_with_no_delivery_attestation_args.checked_at,
        expiresAt: attestation.refund_with_no_delivery_attestation_args.expires_at,
        noDeliveryAttesterSignature:
          attestation.refund_with_no_delivery_attestation_args.no_delivery_attester_signature,
      });
      const attestationRecord = buildNoDeliveryAttestationRecord(attestation);
      const checkedAtDate = dateFromUnixSeconds(attestation.checked_at);

      await prisma.job.updateMany({
        where: {
          request_id: job.request_id,
          status: { in: [JobStatus.RUNNING, JobStatus.FAILED, JobStatus.REFUNDED] },
        },
        data: {
          status: JobStatus.REFUNDED,
          error_message: parsed.data.error_message ?? "provider_cancelled",
          no_delivery_attestation: attestationRecord as Prisma.InputJsonValue,
          no_delivery_attested_at: checkedAtDate,
        },
      });
      await prisma.escrow.updateMany({
        where: { request_id: job.request_id, escrow_status: { in: ["LOCKED", "DISPUTED"] } },
        data: {
          escrow_status: "REFUNDED",
          refund_tx_hash: relayed.transaction_hash,
        },
      });

      const updated = await prisma.job.findUniqueOrThrow({
        where: { request_id: job.request_id },
      });
      return reply.send({
        ...serializeJob(updated),
        refund_with_no_delivery_attestation_args: attestation.refund_with_no_delivery_attestation_args,
        refund_deferred_until: null,
        transaction_hash: relayed.transaction_hash,
        relayer_address: relayed.relayer_address,
        block_number: relayed.block_number,
        gas_used: relayed.gas_used,
        refund_amount: relayed.amount,
      });
    } catch (err) {
      if (err instanceof CreateJobAuthorizationError) {
        return reply.status(err.statusCode as 400 | 404 | 409 | 500).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>("/jobs/:id/acceptance-request", {
    preHandler: requireUserAuth,
    schema: {
      tags: ["Jobs"],
      summary: "Build the EIP-712 payload the user signs to accept output",
      params: idParamsSchema,
      body: outputCommitmentSchema,
      response: {
        200: z.object({
          typed_data: z.unknown(),
          settle_with_user_signature_args: z.object({
            job_id: z.string(),
            output_commitment: z.string(),
            expires_at: z.number(),
          }),
        }),
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        401: z.object({ error: z.string() }),
        403: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = outputCommitmentSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const job = await getJobWithProvider(req.params.id);
    if (!job) return notFound(reply);
    if (ensureUserOwnsJob(req, reply, job) !== true) return;
    if (!isStatus(job.status, [JobStatus.RUNNING, JobStatus.SUBMITTED, JobStatus.ACCEPTED])) {
      return conflict(reply, `job_not_acceptance_ready_status_${job.status}`);
    }

    try {
      const outputJson = Object.prototype.hasOwnProperty.call(parsed.data, "output")
        ? parsed.data.output
        : job.output ?? undefined;
      const outputCommitment = normalizeOutputCommitment({
        outputCommitment: parsed.data.output_commitment,
        outputHash: parsed.data.output_hash ?? job.output_hash ?? undefined,
        outputJson,
      });
      return reply.send(buildJobAcceptance({
        ...ensureOnchainJob(job),
        outputCommitment,
        expiresAt: parsed.data.expires_at,
        expiresInSeconds: parsed.data.expires_in_seconds,
      }));
    } catch (err) {
      if (err instanceof CreateJobAuthorizationError) {
        return reply.status(err.statusCode as 400 | 404 | 409 | 500).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>("/jobs/:id/acceptance", {
    preHandler: requireUserAuth,
    schema: {
      tags: ["Jobs"],
      summary: "Accept a submitted job and relay settleWithUserSignature",
      params: idParamsSchema,
      body: acceptanceSchema,
      response: {
        200: jobResponseSchema.extend({
          settle_with_user_signature_args: z.object({
            job_id: z.string(),
            output_commitment: z.string(),
            expires_at: z.number(),
            user_signature: z.string(),
          }),
          transaction_hash: z.string(),
          relayer_address: z.string(),
          block_number: z.number().nullable(),
          gas_used: z.string().nullable(),
          provider_payout_wallet: z.string().nullable(),
          provider_amount: z.string().nullable(),
          protocol_fee: z.string().nullable(),
        }),
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        401: z.object({ error: z.string() }),
        403: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = acceptanceSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);

    const job = await getJobWithProvider(req.params.id);
    if (!job) return notFound(reply);
    if (ensureUserOwnsJob(req, reply, job) !== true) return;
    if (!isStatus(job.status, [JobStatus.SUBMITTED, JobStatus.ACCEPTED])) {
      return conflict(reply, `job_not_submitted_status_${job.status}`);
    }

    try {
      const outputJson = Object.prototype.hasOwnProperty.call(parsed.data, "output")
        ? parsed.data.output
        : job.output ?? undefined;
      const outputCommitment = normalizeOutputCommitment({
        outputCommitment: parsed.data.output_commitment,
        outputHash: parsed.data.output_hash ?? job.output_hash ?? undefined,
        outputJson,
      });
      const acceptance = buildJobAcceptance({
        ...ensureOnchainJob(job),
        outputCommitment,
        expiresAt: parsed.data.expires_at,
      });
      const settleArgs = {
        ...acceptance.settle_with_user_signature_args,
        user_signature: parsed.data.user_signature,
      };
      const relayed = await relaySettleWithUserSignature({
        jobId: settleArgs.job_id,
        outputCommitment: settleArgs.output_commitment,
        expiresAt: settleArgs.expires_at,
        userSignature: settleArgs.user_signature,
      });

      const settledAt = relayed.settled_at != null ? dateFromUnixSeconds(relayed.settled_at) : new Date();
      const updated = await prisma.job.update({
        where: { request_id: job.request_id },
        data: {
          status: JobStatus.SETTLED,
          output: parsed.data.output === undefined ? undefined : (parsed.data.output as Prisma.InputJsonValue),
          output_hash: outputCommitment,
          accepted_at: job.accepted_at ?? settledAt,
          settled_at: settledAt,
        },
      });
      await prisma.escrow.updateMany({
        where: { request_id: job.request_id, escrow_status: { in: ["LOCKED", "DISPUTED"] } },
        data: {
          escrow_status: "RELEASED",
          release_tx_hash: relayed.transaction_hash,
        },
      });

      return reply.send({
        ...serializeJob(updated),
        settle_with_user_signature_args: settleArgs,
        transaction_hash: relayed.transaction_hash,
        relayer_address: relayed.relayer_address,
        block_number: relayed.block_number,
        gas_used: relayed.gas_used,
        provider_payout_wallet: relayed.provider_payout_wallet,
        provider_amount: relayed.provider_amount,
        protocol_fee: relayed.protocol_fee,
      });
    } catch (err) {
      if (err instanceof CreateJobAuthorizationError) {
        return reply.status(err.statusCode as 400 | 404 | 409 | 500).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>("/jobs/:id/refund-after-queue-timeout", {
    preHandler: requireUserAuth,
    schema: {
      tags: ["Jobs"],
      summary: "Return refundAfterQueueTimeout transaction after queue deadline",
      params: idParamsSchema,
      response: {
        200: preparedTransactionResponseSchema,
        401: z.object({ error: z.string() }),
        403: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const job = await getJobWithProvider(req.params.id);
    if (!job) return notFound(reply);
    if (ensureUserOwnsJob(req, reply, job) !== true) return;
    if (!job.job_id) return conflict(reply, "job_not_funded_onchain");
    if (job.status !== JobStatus.FUNDED) return conflict(reply, `job_not_queued_status_${job.status}`);
    if (!job.queue_deadline) return conflict(reply, "queue_deadline_missing");
    if (job.queue_deadline.getTime() >= Date.now()) return conflict(reply, "queue_deadline_not_expired");

    await prisma.job.update({
      where: { request_id: job.request_id },
      data: { status: JobStatus.EXPIRED, error_message: "queue_deadline_expired" },
    });
    return reply.send(buildRefundAfterQueueTimeoutTransaction(job.job_id));
  });

  app.post<{ Params: { id: string } }>("/jobs/:id/refund-after-final-timeout", {
    preHandler: requireUserAuth,
    schema: {
      tags: ["Jobs"],
      summary: "Return refundAfterFinalTimeout transaction after final refund deadline",
      params: idParamsSchema,
      response: {
        200: preparedTransactionResponseSchema,
        401: z.object({ error: z.string() }),
        403: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const job = await getJobWithProvider(req.params.id);
    if (!job) return notFound(reply);
    if (ensureUserOwnsJob(req, reply, job) !== true) return;
    if (!job.job_id) return conflict(reply, "job_not_funded_onchain");
    if (!isStatus(job.status, [JobStatus.RUNNING, JobStatus.SUBMITTED, JobStatus.ACCEPTED, JobStatus.FAILED])) {
      return conflict(reply, `job_not_running_status_${job.status}`);
    }
    if (!job.final_refund_deadline) return conflict(reply, "final_refund_deadline_missing");
    if (job.final_refund_deadline.getTime() >= Date.now()) return conflict(reply, "final_refund_deadline_not_expired");

    await prisma.job.update({
      where: { request_id: job.request_id },
      data: { status: JobStatus.EXPIRED, error_message: "final_refund_deadline_expired" },
    });
    return reply.send(buildRefundAfterFinalTimeoutTransaction(job.job_id));
  });
}
