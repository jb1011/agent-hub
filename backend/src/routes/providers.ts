import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { serializeProvider } from "../lib/serialize.js";
import { notFound, sendZodError } from "../lib/http-errors.js";
import { uint256StringSchema } from "../lib/uint256.js";

const createSchema = z.object({
  provider_id: uint256StringSchema("provider_id"),
  name: z.string().min(1),
  description: z.string().optional(),
  owner_wallet: z.string().min(1),
  payout_wallet: z.string().min(1),
  api_base_url: z.string().url(),
  trust_level: z.enum(["UNVERIFIED", "VERIFIED", "CERTIFIED", "HOSTED"]).optional(),
  status: z.enum(["REGISTERED", "ACTIVE", "SUSPENDED"]).optional(),
});

const updateSchema = createSchema.omit({ provider_id: true }).partial();
const idParamsSchema = z.object({ id: uint256StringSchema("provider_id") });

export async function providersRoutes(app: FastifyInstance) {
  app.get("/providers", async (_req, reply) => {
    const providers = await prisma.provider.findMany({
      orderBy: { created_at: "desc" },
    });
    return reply.send(providers.map(serializeProvider));
  });

  app.get<{ Params: { id: string } }>("/providers/:id", async (req, reply) => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) return sendZodError(reply, params.error);
    const provider = await prisma.provider.findUnique({
      where: { provider_id: params.data.id },
      include: { services: true },
    });
    if (!provider) return notFound(reply);
    return reply.send({
      ...serializeProvider(provider),
      services: provider.services.map((s) => ({
        service_id: s.service_id,
        name: s.name,
        status: s.status,
      })),
    });
  });

  app.post("/providers", async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const provider = await prisma.provider.create({ data: parsed.data });
    return reply.status(201).send(serializeProvider(provider));
  });

  app.patch<{ Params: { id: string } }>("/providers/:id", async (req, reply) => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) return sendZodError(reply, params.error);
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const existing = await prisma.provider.findUnique({
      where: { provider_id: params.data.id },
    });
    if (!existing) return notFound(reply);
    const provider = await prisma.provider.update({
      where: { provider_id: params.data.id },
      data: parsed.data,
    });
    return reply.send(serializeProvider(provider));
  });

  app.delete<{ Params: { id: string } }>("/providers/:id", async (req, reply) => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) return sendZodError(reply, params.error);
    const existing = await prisma.provider.findUnique({
      where: { provider_id: params.data.id },
    });
    if (!existing) return notFound(reply);
    await prisma.provider.delete({ where: { provider_id: params.data.id } });
    return reply.status(204).send();
  });
}
