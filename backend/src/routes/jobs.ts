import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { serializeJob, serializeEscrow } from "../lib/serialize.js";
import { notFound, sendZodError, forbidden, conflict } from "../lib/http-errors.js";
import {
  CreateJobAuthorizationError,
  isBytes32,
  signCreateJobAuthorization,
} from "../lib/create-job-authorization.js";
import { uint256StringSchema } from "../lib/uint256.js";

const JOB_STATUS = [
  "CREATED", "FUNDED", "RUNNING", "SUBMITTED",
  "ACCEPTED", "SETTLED", "FAILED", "EXPIRED", "REFUNDED", "DISPUTED",
] as const;

// Valid transitions: which statuses can move to which
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

export async function jobsRoutes(app: FastifyInstance) {
  app.get("/jobs", async (req, reply) => {
    const query = z
      .object({
        request_id: z.string().optional(),
        job_id: z.string().optional(),
        user_wallet: z.string().optional(),
        service_id: uint256StringSchema("service_id").optional(),
        status: z.enum(JOB_STATUS).optional(),
      })
      .safeParse(req.query);
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

  app.get<{ Params: { id: string } }>("/jobs/:id", async (req, reply) => {
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

  app.post("/jobs", async (req, reply) => {
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
        return reply.status(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>("/jobs/:id/onchain-job", async (req, reply) => {
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

  app.patch<{ Params: { id: string } }>("/jobs/:id/status", async (req, reply) => {
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
