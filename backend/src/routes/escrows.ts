import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { serializeEscrow } from "../lib/serialize.js";
import { notFound, sendZodError, conflict } from "../lib/http-errors.js";

const createSchema = z.object({
  job_id: z.string().min(1),
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

export async function escrowsRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/escrows/:id", async (req, reply) => {
    const escrow = await prisma.escrow.findUnique({
      where: { escrow_id: req.params.id },
    });
    if (!escrow) return notFound(reply);
    return reply.send(serializeEscrow(escrow));
  });

  app.get<{ Params: { job_id: string } }>("/jobs/:job_id/escrow", async (req, reply) => {
    const escrow = await prisma.escrow.findUnique({
      where: { job_id: req.params.job_id },
    });
    if (!escrow) return notFound(reply);
    return reply.send(serializeEscrow(escrow));
  });

  app.post("/escrows", async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const jobExists = await prisma.job.findUnique({
      where: { job_id: parsed.data.job_id },
    });
    if (!jobExists) return notFound(reply, "job_not_found");
    const existing = await prisma.escrow.findUnique({
      where: { job_id: parsed.data.job_id },
    });
    if (existing) return conflict(reply, "escrow_already_exists_for_job");
    const escrow = await prisma.escrow.create({ data: parsed.data });
    return reply.status(201).send(serializeEscrow(escrow));
  });

  app.post<{ Params: { id: string } }>("/escrows/:id/fund", async (req, reply) => {
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

  app.post<{ Params: { id: string } }>("/escrows/:id/release", async (req, reply) => {
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

  app.post<{ Params: { id: string } }>("/escrows/:id/refund", async (req, reply) => {
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

  app.post<{ Params: { id: string } }>("/escrows/:id/dispute", async (req, reply) => {
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
