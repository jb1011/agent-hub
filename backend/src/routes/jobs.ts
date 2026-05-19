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

const userSignatureSchema = outputCommitmentSchema.extend({
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
        201: jobResponseSchema.extend({
          create_job_args: z.object({
            service_id: z.string(),
            request_id: z.string(),
            input_commitment: z.string(),
            queue_timeout_seconds: z.number(),
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

      const job = await prisma.job.create({
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

      return reply.status(201).send({
        ...serializeJob(job),
        create_job_args: {
          service_id: authorization.service_id,
          request_id: authorization.request_id,
          input_commitment: authorization.input_commitment,
          queue_timeout_seconds: authorization.queue_timeout_seconds,
          expires_at: authorization.expires_at,
          delivery_attester_signature: authorization.delivery_attester_signature,
        },
      });
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
      summary: "Return startJob calldata arguments after provider signed StartJobAuthorization",
      params: idParamsSchema,
      body: providerSignatureSchema,
      response: {
        200: z.object({
          start_job_args: z.object({
            job_id: z.string(),
            expires_at: z.number(),
            provider_signature: z.string(),
          }),
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
      return reply.send({
        start_job_args: {
          ...authorization.start_job_args,
          provider_signature: parsed.data.provider_signature,
        },
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

  app.post<{ Params: { id: string } }>("/jobs/:id/settle-with-user-signature", {
    schema: {
      tags: ["Jobs"],
      summary: "Return settleWithUserSignature calldata arguments",
      params: idParamsSchema,
      body: userSignatureSchema,
      response: {
        200: jobResponseSchema.extend({
          settle_with_user_signature_args: z.object({
            job_id: z.string(),
            output_commitment: z.string(),
            expires_at: z.number(),
            user_signature: z.string(),
          }),
        }),
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = userSignatureSchema.safeParse(req.body);
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
        expiresInSeconds: parsed.data.expires_in_seconds,
      });
      const updated = await prisma.job.update({
        where: { request_id: job.request_id },
        data: {
          status: JobStatus.ACCEPTED,
          output_uri: parsed.data.output_uri ?? job.output_uri,
          output_hash: outputCommitment,
          accepted_at: new Date(),
        },
      });
      return reply.send({
        ...serializeJob(updated),
        settle_with_user_signature_args: {
          ...acceptance.settle_with_user_signature_args,
          user_signature: parsed.data.user_signature,
        },
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
      summary: "Return refundAfterQueueTimeout calldata arguments after queue deadline",
      params: idParamsSchema,
      response: {
        200: jobResponseSchema.extend({
          refund_after_queue_timeout_args: z.object({ job_id: z.string() }),
        }),
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

    const updated = await prisma.job.update({
      where: { request_id: job.request_id },
      data: { status: JobStatus.EXPIRED, error_message: "queue_deadline_expired" },
    });
    return reply.send({
      ...serializeJob(updated),
      refund_after_queue_timeout_args: { job_id: job.job_id },
    });
  });

  app.post<{ Params: { id: string } }>("/jobs/:id/refund-after-final-timeout", {
    schema: {
      tags: ["Jobs"],
      summary: "Return refundAfterFinalTimeout calldata arguments after final refund deadline",
      params: idParamsSchema,
      response: {
        200: jobResponseSchema.extend({
          refund_after_final_timeout_args: z.object({ job_id: z.string() }),
        }),
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

    const updated = await prisma.job.update({
      where: { request_id: job.request_id },
      data: { status: JobStatus.EXPIRED, error_message: "final_refund_deadline_expired" },
    });
    return reply.send({
      ...serializeJob(updated),
      refund_after_final_timeout_args: { job_id: job.job_id },
    });
  });
}
