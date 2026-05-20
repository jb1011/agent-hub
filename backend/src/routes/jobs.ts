import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";
import { JobStatus, type Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { serializeJob, serializeEscrow } from "../lib/serialize.js";
import { notFound, sendZodError, conflict } from "../lib/http-errors.js";
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
  relaySettleAfterReviewTimeout,
  relaySettleWithUserSignature,
  relayStartJob,
} from "../lib/escrow-relayer.js";
import {
  buildCreateJobTransaction,
  buildRefundAfterFinalTimeoutTransaction,
  buildRefundAfterQueueTimeoutTransaction,
} from "../lib/escrow-transaction.js";
import { uint256StringSchema } from "../lib/uint256.js";

const JOB_STATUS = [
  "CREATED", "FUNDED", "RUNNING", "SUBMITTED",
  "ACCEPTED", "SETTLED", "FAILED", "EXPIRED", "REFUNDED", "DISPUTED",
] as const;

const CAPACITY_JOB_STATUSES: JobStatus[] = [
  JobStatus.RUNNING,
  JobStatus.SUBMITTED,
  JobStatus.ACCEPTED,
  JobStatus.DISPUTED,
];

const REVIEW_TIMEOUT_SETTLEMENT_JOB_STATUSES: JobStatus[] = [
  JobStatus.SUBMITTED,
  JobStatus.ACCEPTED,
];

const createSchema = z.object({
  job_id: z.string().min(1).optional(),
  request_id: z.string().refine(isBytes32, "request_id must be bytes32").optional(),
  user_wallet: z.string().min(1),
  service_id: uint256StringSchema("service_id"),
  input_uri: z.string().optional(),
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

const outputCommitmentSchema = authExpirySchema.extend({
  output_uri: z.string().optional(),
  output_hash: z.string().optional(),
  output_commitment: z.string().refine(isBytes32, "output_commitment must be bytes32").optional(),
});

const deliveryAttestationSchema = outputCommitmentSchema.extend({
  output: z.unknown().optional(),
});

const acceptanceSchema = outputCommitmentSchema.extend({
  expires_at: z.number().int().positive(),
  user_signature: z.string().min(1),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

const jobResponseSchema = z.object({
  request_id: z.string(),
  job_id: z.string().nullable(),
  user_wallet: z.string(),
  service_id: z.string(),
  status: z.string(),
  input_uri: z.string().nullable(),
  input_hash: z.string().nullable(),
  output_uri: z.string().nullable(),
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
  service_id: uint256StringSchema("service_id").optional(),
  status: z.enum(JOB_STATUS).optional(),
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

async function getJobWithService(id: string) {
  return prisma.job.findFirst({
    where: { OR: [{ request_id: id }, { job_id: id }] },
    include: { service: true },
  });
}

async function runningCapacityForService(serviceId: string) {
  return prisma.job.count({
    where: {
      service_id: serviceId,
      status: { in: CAPACITY_JOB_STATUSES },
    },
  });
}

async function ensureStartable(job: Awaited<ReturnType<typeof getJobWithService>>) {
  if (!job) return "job_not_found";
  if (!job.job_id) return "job_not_funded_onchain";
  if (!job.input_hash) return "input_commitment_missing";
  if (job.status !== JobStatus.FUNDED) return `job_not_funded_status_${job.status}`;
  if (job.queue_deadline && job.queue_deadline.getTime() <= Date.now()) {
    return "queue_deadline_expired";
  }
  const activeJobs = await runningCapacityForService(job.service_id);
  if (activeJobs >= job.service.max_concurrent_jobs) return "service_capacity_exceeded";
  return null;
}

function ensureOnchainJob(job: Awaited<ReturnType<typeof getJobWithService>>) {
  if (!job) throw new CreateJobAuthorizationError("job_not_found", 404);
  if (!job.job_id) throw new CreateJobAuthorizationError("job_not_funded_onchain", 409);
  if (!job.input_hash) throw new CreateJobAuthorizationError("input_commitment_missing", 409);
  return {
    jobId: job.job_id,
    providerId: job.service.provider_id,
    serviceId: job.service_id,
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
  job: NonNullable<Awaited<ReturnType<typeof getJobWithService>>>,
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
  job: NonNullable<Awaited<ReturnType<typeof getJobWithService>>>,
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
  job: NonNullable<Awaited<ReturnType<typeof getJobWithService>>>,
  checkedAt = Math.floor(Date.now() / 1000)
) {
  if (job.status !== JobStatus.RUNNING || job.delivered_at || !job.work_deadline) return null;
  if (checkedAt <= unixSeconds(job.work_deadline)) return null;

  const attestation = await signNoDeliveryAttestation({
    ...ensureOnchainJob(job),
    checkedAt,
  });
  const attestationRecord = buildNoDeliveryAttestationRecord(attestation);
  const checkedAtDate = dateFromUnixSeconds(attestation.checked_at);
  const updated = await prisma.job.updateMany({
    where: {
      request_id: job.request_id,
      status: JobStatus.RUNNING,
      delivered_at: null,
      work_deadline: { lt: checkedAtDate },
    },
    data: {
      status: JobStatus.FAILED,
      error_message: "no_delivery_attested",
      no_delivery_attestation: attestationRecord as Prisma.InputJsonValue,
      no_delivery_attested_at: checkedAtDate,
    },
  });

  if (updated.count === 0) return null;

  const updatedJob = await prisma.job.findUniqueOrThrow({
    where: { request_id: job.request_id },
  });

  return {
    job: updatedJob,
    refund_with_no_delivery_attestation_args: attestation.refund_with_no_delivery_attestation_args,
  };
}

export async function emitExpiredNoDeliveryAttestations(logger?: FastifyBaseLogger) {
  const expiredJobs = await prisma.job.findMany({
    where: {
      status: JobStatus.RUNNING,
      delivered_at: null,
      work_deadline: { lt: new Date() },
    },
    include: { service: true },
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
    logger?.info({ emitted }, "Expired running jobs received NoDeliveryAttestations");
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
    include: { service: true },
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
    schema: {
      tags: ["Jobs"],
      summary: "List jobs with optional filters",
      querystring: listQuerySchema,
      response: { 200: z.array(jobResponseSchema) },
    },
  }, async (req, reply) => {
    const query = listQuerySchema.safeParse(req.query);
    if (!query.success) return sendZodError(reply, query.error);
    const where = query.success
      ? {
          ...(query.data.request_id ? { request_id: query.data.request_id } : {}),
          ...(query.data.job_id ? { job_id: query.data.job_id } : {}),
          ...(query.data.user_wallet ? { user_wallet: query.data.user_wallet } : {}),
          ...(query.data.service_id ? { service_id: query.data.service_id } : {}),
          ...(query.data.status ? { status: query.data.status } : {}),
        }
      : {};
    const jobs = await prisma.job.findMany({
      where,
      orderBy: { created_at: "desc" },
    });
    return reply.send(jobs.map(serializeJob));
  });

  app.get<{ Params: { id: string } }>("/jobs/:id", {
    schema: {
      tags: ["Jobs"],
      summary: "Get a job by request_id or job_id (includes escrow and service info)",
      params: idParamsSchema,
      response: {
        200: jobResponseSchema.extend({
          escrow: z.unknown().nullable(),
          service: z.object({
            service_id: z.string(),
            name: z.string(),
            price_usdc: z.string(),
          }),
        }),
        404: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const job = await prisma.job.findFirst({
      where: { OR: [{ request_id: req.params.id }, { job_id: req.params.id }] },
      include: { escrow: true, service: true },
    });
    if (!job) return notFound(reply);
    return reply.send({
      ...serializeJob(job),
      escrow: job.escrow ? serializeEscrow(job.escrow) : null,
      service: {
        service_id: job.service.service_id,
        name: job.service.name,
        price_usdc: job.service.price_usdc.toString(),
      },
    });
  });

  app.post("/jobs", {
    schema: {
      tags: ["Jobs"],
      summary: "Create a job and generate on-chain creation arguments",
      body: createSchema,
      response: {
        201: preparedTransactionResponseSchema,
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const service = await prisma.service.findUnique({
      where: { service_id: parsed.data.service_id }
    });
    if (!service) return notFound(reply, "service_not_found");

    if (parsed.data.request_id) {
      const existing = await prisma.job.findUnique({
        where: { request_id: parsed.data.request_id },
      });
      if (existing) return conflict(reply, "request_id_already_exists");
    }

    try {
      const authorization = await signCreateJobAuthorization({
        userWallet: parsed.data.user_wallet,
        providerId: service.provider_id,
        serviceId: service.service_id,
        priceUsdc: service.price_usdc.toString(),
        workTimeoutSeconds: service.timeout_seconds,
        requestId: parsed.data.request_id,
        inputCommitment: parsed.data.input_commitment,
        inputHash: parsed.data.input_hash,
        inputUri: parsed.data.input_uri,
        queueTimeoutSeconds: parsed.data.queue_timeout_seconds,
        expiresAt: parsed.data.authorization_expires_at,
        expiresInSeconds: parsed.data.authorization_expires_in_seconds,
      });

      await prisma.job.create({
        data: {
          request_id: authorization.request_id,
          user_wallet: authorization.user_wallet,
          service_id: parsed.data.service_id,
          input_uri: parsed.data.input_uri,
          input_hash: authorization.input_commitment,
          work_deadline: parsed.data.work_deadline
            ? new Date(parsed.data.work_deadline)
            : undefined,
          review_deadline: parsed.data.review_deadline
            ? new Date(parsed.data.review_deadline)
            : undefined,
        },
      });

      return reply.status(201).send(buildCreateJobTransaction({
        serviceId: authorization.service_id,
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

  app.post<{ Params: { id: string } }>("/jobs/:id/start-authorization-request", {
    schema: {
      tags: ["Jobs"],
      summary: "Build the EIP-712 payload the provider signs before startJob",
      params: idParamsSchema,
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
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = authExpirySchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const job = await getJobWithService(req.params.id);
    const notStartable = await ensureStartable(job);
    if (notStartable === "job_not_found") return notFound(reply);
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
          input_uri: z.string().nullable(),
          transaction_hash: z.string(),
          relayer_address: z.string(),
          block_number: z.number().nullable(),
          gas_used: z.string().nullable(),
        }),
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = providerSignatureSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const job = await getJobWithService(req.params.id);
    const notStartable = await ensureStartable(job);
    if (notStartable === "job_not_found") return notFound(reply);
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

      return reply.send({
        input_uri: job!.input_uri,
        transaction_hash: relayed.transaction_hash,
        relayer_address: relayed.relayer_address,
        block_number: relayed.block_number,
        gas_used: relayed.gas_used,
      });
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
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = deliveryAttestationSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const job = await getJobWithService(req.params.id);
    if (!job) return notFound(reply);
    if (job.status !== JobStatus.RUNNING) {
      return conflict(reply, `job_not_running_status_${job.status}`);
    }

    try {
      if (job.service.output_schema && parsed.data.output === undefined) {
        return reply.status(400).send({ error: "output_required_for_schema_validation" });
      }
      const schemaError = validateJsonSchemaShape(parsed.data.output, job.service.output_schema);
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
        outputUri: parsed.data.output_uri,
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
          output_uri: parsed.data.output_uri,
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

  app.post<{ Params: { id: string } }>("/jobs/:id/acceptance-request", {
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
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = outputCommitmentSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const job = await getJobWithService(req.params.id);
    if (!job) return notFound(reply);
    if (!isStatus(job.status, [JobStatus.RUNNING, JobStatus.SUBMITTED, JobStatus.ACCEPTED])) {
      return conflict(reply, `job_not_acceptance_ready_status_${job.status}`);
    }

    try {
      const outputCommitment = normalizeOutputCommitment({
        outputCommitment: parsed.data.output_commitment,
        outputHash: parsed.data.output_hash ?? job.output_hash ?? undefined,
        outputUri: parsed.data.output_uri ?? job.output_uri ?? undefined,
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
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = acceptanceSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);

    const job = await getJobWithService(req.params.id);
    if (!job) return notFound(reply);
    if (!isStatus(job.status, [JobStatus.SUBMITTED, JobStatus.ACCEPTED])) {
      return conflict(reply, `job_not_submitted_status_${job.status}`);
    }

    try {
      const outputCommitment = normalizeOutputCommitment({
        outputCommitment: parsed.data.output_commitment,
        outputHash: parsed.data.output_hash ?? job.output_hash ?? undefined,
        outputUri: parsed.data.output_uri ?? job.output_uri ?? undefined,
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
          output_uri: parsed.data.output_uri ?? job.output_uri,
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
    schema: {
      tags: ["Jobs"],
      summary: "Return refundAfterQueueTimeout transaction after queue deadline",
      params: idParamsSchema,
      response: {
        200: preparedTransactionResponseSchema,
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const job = await getJobWithService(req.params.id);
    if (!job) return notFound(reply);
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
    schema: {
      tags: ["Jobs"],
      summary: "Return refundAfterFinalTimeout transaction after final refund deadline",
      params: idParamsSchema,
      response: {
        200: preparedTransactionResponseSchema,
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const job = await getJobWithService(req.params.id);
    if (!job) return notFound(reply);
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
