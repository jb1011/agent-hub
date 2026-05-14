import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { prisma } from "../lib/prisma.js";
import { serializeJob, serializeUsageEvent } from "../lib/serialize.js";
import { conflict, forbidden, notFound, sendZodError } from "../lib/http-errors.js";
import {
  confirmJobPaymentBody,
  createJobBody,
  createUsageEventBody,
  patchJobBody,
} from "../validation/schemas.js";

function paymentConfirmationOk(request: FastifyRequest, reply: import("fastify").FastifyReply): boolean {
  const token = process.env.PAYMENT_CONFIRMATION_TOKEN;
  if (!token) {
    if (process.env.NODE_ENV === "production") {
      reply.status(503).send({ error: "payment_confirmation_token_not_configured" });
      return false;
    }
    return true;
  }
  const header = request.headers["x-payment-confirmation"];
  if (typeof header !== "string" || header !== token) {
    reply.status(401).send({ error: "invalid_payment_confirmation" });
    return false;
  }
  return true;
}

export const jobsRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/jobs", async (request, reply) => {
    const parsed = createJobBody.safeParse(request.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);

    const { agentId, buyerId, idempotencyKey } = parsed.data;

    if (idempotencyKey) {
      const existing = await prisma.job.findUnique({ where: { idempotencyKey } });
      if (existing) return reply.status(200).send(serializeJob(existing));
    }

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return notFound(reply, "agent_not_found");
    if (agent.status !== "published") return conflict(reply, "agent_not_published");

    const buyer = await prisma.user.findUnique({ where: { id: buyerId } });
    if (!buyer) return notFound(reply, "buyer_not_found");

    try {
      const job = await prisma.job.create({
        data: {
          agentId,
          buyerId,
          status: "quoted",
          amountMicroUsdc: agent.priceMicroUsdc,
          idempotencyKey: idempotencyKey ?? null,
        },
      });
      return reply.status(201).send(serializeJob(job));
    } catch (e: unknown) {
      if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002") {
        const existing = await prisma.job.findUnique({ where: { idempotencyKey: idempotencyKey! } });
        if (existing) return reply.status(200).send(serializeJob(existing));
        return conflict(reply, "idempotency_conflict");
      }
      throw e;
    }
  });

  app.get("/api/jobs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) return notFound(reply, "job_not_found");
    return serializeJob(job);
  });

  app.post("/api/jobs/:id/confirm-payment", async (request, reply) => {
    if (!paymentConfirmationOk(request, reply)) return;

    const parsed = confirmJobPaymentBody.safeParse(request.body ?? {});
    if (!parsed.success) return sendZodError(reply, parsed.error);

    const { id } = request.params as { id: string };
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) return notFound(reply, "job_not_found");
    if (job.status !== "quoted") return conflict(reply, "job_not_quoted");

    const updated = await prisma.job.update({
      where: { id },
      data: {
        status: "paid",
        contractRef: parsed.data.contractRef ?? null,
        onchainJobId: parsed.data.onchainJobId ?? null,
      },
    });
    return serializeJob(updated);
  });

  app.patch("/api/jobs/:id", async (request, reply) => {
    const parsed = patchJobBody.safeParse(request.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);

    const { id } = request.params as { id: string };
    const { buyerId } = (request.query ?? {}) as { buyerId?: string };
    if (!buyerId) return reply.status(400).send({ error: "buyerId_query_required" });

    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) return notFound(reply, "job_not_found");
    if (job.buyerId !== buyerId) return forbidden(reply, "not_job_buyer");

    const next = parsed.data.status;
    const allowed: Record<string, string[]> = {
      paid: ["in_progress", "cancelled"],
      in_progress: ["completed", "failed", "cancelled"],
    };
    const ok = allowed[job.status]?.includes(next);
    if (!ok) return conflict(reply, "invalid_status_transition");

    const updated = await prisma.job.update({
      where: { id },
      data: { status: next },
    });
    return serializeJob(updated);
  });

  app.post("/api/jobs/:id/usage-events", async (request, reply) => {
    const parsed = createUsageEventBody.safeParse(request.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);

    const { id } = request.params as { id: string };
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) return notFound(reply, "job_not_found");
    if (job.status !== "paid" && job.status !== "in_progress") {
      return conflict(reply, "job_not_active");
    }

    const event = await prisma.usageEvent.create({
      data: {
        jobId: id,
        latencyMs: parsed.data.latencyMs ?? null,
        error: parsed.data.error ?? null,
        toolName: parsed.data.toolName ?? null,
      },
    });
    return reply.status(201).send(serializeUsageEvent(event));
  });
};
