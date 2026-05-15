import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { serializeJob, serializeEscrow } from "../lib/serialize.js";
import { notFound, sendZodError, forbidden } from "../lib/http-errors.js";

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
  user_wallet: z.string().min(1),
  service_id: z.string().min(1),
  input_uri: z.string().optional(),
  input_hash: z.string().optional(),
  work_deadline: z.string().datetime().optional(),
  review_deadline: z.string().datetime().optional(),
});

const transitionSchema = z.object({
  status: z.enum(JOB_STATUS),
  output_uri: z.string().optional(),
  output_hash: z.string().optional(),
  error_message: z.string().optional(),
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
        user_wallet: z.string().optional(),
        service_id: z.string().optional(),
        status: z.enum(JOB_STATUS).optional(),
      })
      .safeParse(req.query);
    const where = query.success
      ? {
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
    const job = await prisma.job.findUnique({
      where: { job_id: req.params.id },
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
    const serviceExists = await prisma.service.findUnique({
      where: { service_id: parsed.data.service_id },
    });
    if (!serviceExists) return notFound(reply, "service_not_found");
    const job = await prisma.job.create({
      data: {
        ...parsed.data,
        work_deadline: parsed.data.work_deadline
          ? new Date(parsed.data.work_deadline)
          : undefined,
        review_deadline: parsed.data.review_deadline
          ? new Date(parsed.data.review_deadline)
          : undefined,
      },
    });
    return reply.status(201).send(serializeJob(job));
  });

  app.patch<{ Params: { id: string } }>("/jobs/:id/status", async (req, reply) => {
    const parsed = transitionSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const job = await prisma.job.findUnique({ where: { job_id: req.params.id } });
    if (!job) return notFound(reply);
    const allowed = TRANSITIONS[job.status] ?? [];
    if (!allowed.includes(parsed.data.status)) {
      return forbidden(
        reply,
        `cannot_transition_from_${job.status}_to_${parsed.data.status}`
      );
    }
    const updated = await prisma.job.update({
      where: { job_id: req.params.id },
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
