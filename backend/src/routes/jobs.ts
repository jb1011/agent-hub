import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { JobStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { serializeJob, serializeEscrow } from "../lib/serialize.js";
import { notFound, sendZodError, forbidden, conflict } from "../lib/http-errors.js";
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

const TRANSITIONS: Record<string, string[]> = {
  CREATED:   ["FUNDED", "EXPIRED"],
  FUNDED:    ["RUNNING", "REFUNDED", "EXPIRED"],
  RUNNING:   ["SUBMITTED", "FAILED", "EXPIRED"],
  SUBMITTED: ["ACCEPTED", "DISPUTED", "EXPIRED"],
  ACCEPTED:  ["SETTLED", "DISPUTED"],
  SETTLED:   [],
  FAILED:    ["REFUNDED"],
  EXPIRED:   ["REFUNDED"],
  REFUNDED:  [],
  DISPUTED:  ["SETTLED", "REFUNDED"],
};

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

const transitionSchema = z.object({
  status: z.enum(JOB_STATUS),
  output_uri: z.string().optional(),
  output_hash: z.string().optional(),
  error_message: z.string().optional(),
});

const onchainJobSchema = z.object({
  job_id: z.string().min(1),
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
  delivered_at: z.number().int().positive().optional(),
});

const userSignatureSchema = outputCommitmentSchema.extend({
  user_signature: z.string().min(1),
});

const noDeliveryAttestationSchema = authExpirySchema.extend({
  checked_at: z.number().int().positive().optional(),
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

function timestampForStatus(status: string): Record<string, Date> {
  const now = new Date();
  const map: Record<string, Record<string, Date>> = {
    FUNDED:    { funded_at: now },
    RUNNING:   { started_at: now },
    SUBMITTED: { submitted_at: now },
    ACCEPTED:  { accepted_at: now },
    SETTLED:   { settled_at: now },
  };
  return map[status] ?? {};
}

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

  app.patch<{ Params: { id: string } }>("/jobs/:id/onchain-job", {
    schema: {
      tags: ["Jobs"],
      summary: "Link an on-chain job_id to a request",
      params: idParamsSchema,
      body: onchainJobSchema,
      response: {
        200: jobResponseSchema,
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = onchainJobSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const job = await prisma.job.findFirst({
      where: { OR: [{ request_id: req.params.id }, { job_id: req.params.id }] },
    });
    if (!job) return notFound(reply);
    const existing = await prisma.job.findUnique({
      where: { job_id: parsed.data.job_id },
    });
    if (existing && existing.request_id !== job.request_id) {
      return conflict(reply, "job_id_already_linked_to_another_request");
    }
    const updated = await prisma.job.update({
      where: { request_id: job.request_id },
      data: { job_id: parsed.data.job_id },
    });
    return reply.send(serializeJob(updated));
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

  app.post<{ Params: { id: string } }>("/jobs/:id/delivery-attestation", {
    schema: {
      tags: ["Jobs"],
      summary: "Validate provider output and sign DeliveryAttestation",
      params: idParamsSchema,
      body: deliveryAttestationSchema,
      response: {
        200: jobResponseSchema.extend({
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
    if (!isStatus(job.status, [JobStatus.RUNNING, JobStatus.SUBMITTED])) {
      return conflict(reply, `job_not_running_status_${job.status}`);
    }

    try {
      const deliveredAt = parsed.data.delivered_at ?? Math.floor(Date.now() / 1000);
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
      const updated = await prisma.job.update({
        where: { request_id: job.request_id },
        data: {
          status: JobStatus.SUBMITTED,
          output_uri: parsed.data.output_uri,
          output_hash: outputCommitment,
          submitted_at: deliveredAtDate,
          delivered_at: deliveredAtDate,
          review_deadline: new Date(deliveredAtDate.getTime() + reviewTimeoutSeconds * 1000),
        },
      });
      return reply.send({
        ...serializeJob(updated),
        settle_after_review_timeout_args: attestation.settle_after_review_timeout_args,
      });
    } catch (err) {
      if (err instanceof CreateJobAuthorizationError) {
        return reply.status(err.statusCode as 400 | 404 | 409 | 500).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>("/jobs/:id/no-delivery-attestation", {
    schema: {
      tags: ["Jobs"],
      summary: "Sign NoDeliveryAttestation after the work deadline",
      params: idParamsSchema,
      body: noDeliveryAttestationSchema,
      response: {
        200: jobResponseSchema.extend({
          refund_with_no_delivery_attestation_args: z.object({
            job_id: z.string(),
            checked_at: z.number(),
            expires_at: z.number(),
            no_delivery_attester_signature: z.string(),
          }),
        }),
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = noDeliveryAttestationSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const job = await getJobWithService(req.params.id);
    if (!job) return notFound(reply);
    if (job.status !== JobStatus.RUNNING) return conflict(reply, `job_not_running_status_${job.status}`);
    if (!job.work_deadline) return conflict(reply, "work_deadline_missing");

    try {
      const checkedAt = parsed.data.checked_at ?? Math.floor(Date.now() / 1000);
      if (checkedAt <= unixSeconds(job.work_deadline)) return conflict(reply, "checked_before_work_deadline");
      const attestation = await signNoDeliveryAttestation({
        ...ensureOnchainJob(job),
        checkedAt,
        expiresAt: parsed.data.expires_at,
        expiresInSeconds: parsed.data.expires_in_seconds,
      });
      const updated = await prisma.job.update({
        where: { request_id: job.request_id },
        data: {
          status: JobStatus.FAILED,
          error_message: "no_delivery_attested",
        },
      });
      return reply.send({
        ...serializeJob(updated),
        refund_with_no_delivery_attestation_args: attestation.refund_with_no_delivery_attestation_args,
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

  app.patch<{ Params: { id: string } }>("/jobs/:id/status", {
    schema: {
      tags: ["Jobs"],
      summary: "Transition job status",
      description: `Valid transitions:\n\`CREATED → FUNDED | EXPIRED\`\n\`FUNDED → RUNNING | REFUNDED | EXPIRED\`\n\`RUNNING → SUBMITTED | FAILED | EXPIRED\`\n\`SUBMITTED → ACCEPTED | DISPUTED | EXPIRED\`\n\`ACCEPTED → SETTLED | DISPUTED\`\n\`FAILED → REFUNDED\`\n\`EXPIRED → REFUNDED\`\n\`DISPUTED → SETTLED | REFUNDED\``,
      params: idParamsSchema,
      body: transitionSchema,
      response: {
        200: jobResponseSchema,
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        403: z.object({ error: z.string() }),
        404: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = transitionSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const job = await prisma.job.findFirst({
      where: { OR: [{ request_id: req.params.id }, { job_id: req.params.id }] },
    });
    if (!job) return notFound(reply);
    const allowed = TRANSITIONS[job.status] ?? [];
    if (!allowed.includes(parsed.data.status)) {
      return forbidden(
        reply,
        `cannot_transition_from_${job.status}_to_${parsed.data.status}`
      );
    }
    const updated = await prisma.job.update({
      where: { request_id: job.request_id },
      data: {
        status: parsed.data.status,
        output_uri: parsed.data.output_uri,
        output_hash: parsed.data.output_hash,
        error_message: parsed.data.error_message,
        ...timestampForStatus(parsed.data.status),
      },
    });
    return reply.send(serializeJob(updated));
  });
}
