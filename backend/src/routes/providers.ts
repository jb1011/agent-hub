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

const idParamsSchema = z.object({
  id: uint256StringSchema("provider_id"),
});

const providerResponseSchema = z.object({
  provider_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  owner_wallet: z.string(),
  payout_wallet: z.string(),
  api_base_url: z.string(),
  trust_level: z.string(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export async function providersRoutes(app: FastifyInstance) {
  app.get("/providers", {
    schema: {
      tags: ["Providers"],
      summary: "List all providers",
      response: { 200: z.array(providerResponseSchema) },
    },
  }, async (_req, reply) => {
    const providers = await prisma.provider.findMany({
      orderBy: { created_at: "desc" },
    });
    return reply.send(providers.map(serializeProvider));
  });

  app.get<{ Params: { id: string } }>("/providers/:id", {
    schema: {
      tags: ["Providers"],
      summary: "Get a provider by ID (includes services)",
      params: idParamsSchema,
      response: {
        200: providerResponseSchema.extend({
          services: z.array(
            z.object({
              service_id: z.string(),
              name: z.string(),
              status: z.string(),
            })
          ),
        }),
        404: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
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

  app.post("/providers", {
    schema: {
      tags: ["Providers"],
      summary: "Register a new provider",
      body: createSchema,
      response: {
        201: providerResponseSchema,
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
      },
    },
  }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const provider = await prisma.provider.create({ data: parsed.data });
    return reply.status(201).send(serializeProvider(provider));
  });

  app.patch<{ Params: { id: string } }>("/providers/:id", {
    schema: {
      tags: ["Providers"],
      summary: "Update a provider",
      params: idParamsSchema,
      body: updateSchema,
      response: {
        200: providerResponseSchema,
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        404: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
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

  app.delete<{ Params: { id: string } }>("/providers/:id", {
    schema: {
      tags: ["Providers"],
      summary: "Delete a provider",
      params: idParamsSchema,
      response: {
        204: z.null(),
        404: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
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
