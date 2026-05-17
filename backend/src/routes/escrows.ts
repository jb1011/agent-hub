import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { serializeEscrow } from "../lib/serialize.js";
import { notFound, sendZodError, conflict } from "../lib/http-errors.js";

const createSchema = z.object({
  request_id: z.string().min(1),
  chain_id: z.number().int().positive(),
  token_address: z.string().min(1),
  escrow_contract: z.string().min(1),
  amount_usdc: z.number().positive(),
  platform_fee_usdc: z.number().min(0),
  provider_payout_usdc: z.number().min(0),
});

const fundSchema = z.object({ fund_tx_hash: z.string().min(1) });
const releaseSchema = z.object({ release_tx_hash: z.string().min(1) });
const refundSchema = z.object({ refund_tx_hash: z.string().min(1) });

const idParamsSchema = z.object({ id: z.string().min(1) });

const escrowResponseSchema = z.object({
  escrow_id: z.string(),
  request_id: z.string(),
  chain_id: z.number(),
  token_address: z.string(),
  escrow_contract: z.string(),
  amount_usdc: z.number(),
  platform_fee_usdc: z.number(),
  provider_payout_usdc: z.number(),
  escrow_status: z.string(),
  fund_tx_hash: z.string().nullable(),
  release_tx_hash: z.string().nullable(),
  refund_tx_hash: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export async function escrowsRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/escrows/:id", {
    schema: {
      tags: ["Escrows"],
      summary: "Get an escrow by escrow_id",
      params: idParamsSchema,
      response: {
        200: escrowResponseSchema,
        404: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const escrow = await prisma.escrow.findUnique({
      where: { escrow_id: req.params.id },
    });
    if (!escrow) return notFound(reply);
    return reply.send(serializeEscrow(escrow));
  });

  app.get<{ Params: { id: string } }>("/jobs/:id/escrow", {
    schema: {
      tags: ["Escrows"],
      summary: "Get the escrow linked to a job (by request_id or job_id)",
      params: idParamsSchema,
      response: {
        200: escrowResponseSchema,
        404: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const escrow = await prisma.escrow.findFirst({
      where: {
        OR: [{ request_id: req.params.id }, { job: { job_id: req.params.id } }],
      },
    });
    if (!escrow) return notFound(reply);
    return reply.send(serializeEscrow(escrow));
  });

  app.post("/escrows", {
    schema: {
      tags: ["Escrows"],
      summary: "Create an escrow record for a job",
      body: createSchema,
      response: {
        201: escrowResponseSchema,
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const jobExists = await prisma.job.findUnique({
      where: { request_id: parsed.data.request_id },
    });
    if (!jobExists) return notFound(reply, "job_not_found");
    const existing = await prisma.escrow.findUnique({
      where: { request_id: parsed.data.request_id },
    });
    if (existing) return conflict(reply, "escrow_already_exists_for_job");
    const escrow = await prisma.escrow.create({ data: parsed.data });
    return reply.status(201).send(serializeEscrow(escrow));
  });

  app.post<{ Params: { id: string } }>("/escrows/:id/fund", {
    schema: {
      tags: ["Escrows"],
      summary: "Mark escrow as funded (UNFUNDED → LOCKED)",
      params: idParamsSchema,
      body: fundSchema,
      response: {
        200: escrowResponseSchema,
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = fundSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const escrow = await prisma.escrow.findUnique({ where: { escrow_id: req.params.id } });
    if (!escrow) return notFound(reply);
    if (escrow.escrow_status !== "UNFUNDED") {
      return conflict(reply, `escrow_already_${escrow.escrow_status.toLowerCase()}`);
    }
    const updated = await prisma.escrow.update({
      where: { escrow_id: req.params.id },
      data: { escrow_status: "LOCKED", fund_tx_hash: parsed.data.fund_tx_hash },
    });
    return reply.send(serializeEscrow(updated));
  });

  app.post<{ Params: { id: string } }>("/escrows/:id/release", {
    schema: {
      tags: ["Escrows"],
      summary: "Release escrow to provider (LOCKED → RELEASED)",
      params: idParamsSchema,
      body: releaseSchema,
      response: {
        200: escrowResponseSchema,
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = releaseSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const escrow = await prisma.escrow.findUnique({ where: { escrow_id: req.params.id } });
    if (!escrow) return notFound(reply);
    if (escrow.escrow_status !== "LOCKED") {
      return conflict(reply, `escrow_not_locked`);
    }
    const updated = await prisma.escrow.update({
      where: { escrow_id: req.params.id },
      data: { escrow_status: "RELEASED", release_tx_hash: parsed.data.release_tx_hash },
    });
    return reply.send(serializeEscrow(updated));
  });

  app.post<{ Params: { id: string } }>("/escrows/:id/refund", {
    schema: {
      tags: ["Escrows"],
      summary: "Refund escrow to user (LOCKED | DISPUTED → REFUNDED)",
      params: idParamsSchema,
      body: refundSchema,
      response: {
        200: escrowResponseSchema,
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = refundSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const escrow = await prisma.escrow.findUnique({ where: { escrow_id: req.params.id } });
    if (!escrow) return notFound(reply);
    if (!["LOCKED", "DISPUTED"].includes(escrow.escrow_status)) {
      return conflict(reply, `cannot_refund_from_${escrow.escrow_status.toLowerCase()}`);
    }
    const updated = await prisma.escrow.update({
      where: { escrow_id: req.params.id },
      data: { escrow_status: "REFUNDED", refund_tx_hash: parsed.data.refund_tx_hash },
    });
    return reply.send(serializeEscrow(updated));
  });

  app.post<{ Params: { id: string } }>("/escrows/:id/dispute", {
    schema: {
      tags: ["Escrows"],
      summary: "Open a dispute on a locked escrow (LOCKED → DISPUTED)",
      params: idParamsSchema,
      response: {
        200: escrowResponseSchema,
        404: z.object({ error: z.string() }),
        409: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const escrow = await prisma.escrow.findUnique({ where: { escrow_id: req.params.id } });
    if (!escrow) return notFound(reply);
    if (!["LOCKED"].includes(escrow.escrow_status)) {
      return conflict(reply, `cannot_dispute_from_${escrow.escrow_status.toLowerCase()}`);
    }
    const updated = await prisma.escrow.update({
      where: { escrow_id: req.params.id },
      data: { escrow_status: "DISPUTED" },
    });
    return reply.send(serializeEscrow(updated));
  });
}
