import type { FastifyInstance } from "fastify";
import { isAddress } from "ethers";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { serializeProvider } from "../lib/serialize.js";
import { notFound, sendZodError } from "../lib/http-errors.js";
import { uint256StringSchema } from "../lib/uint256.js";
import { agentHubRegistryAddress, buildRegisterProviderCall } from "../lib/registry-call.js";

const evmAddressSchema = (fieldName: string) =>
  z.string().refine(isAddress, `${fieldName}_must_be_evm_address`);

const usdcAmountSchema = z
  .number()
  .positive()
  .refine((value) => /^\d+(\.\d{1,6})?$/.test(value.toString()), "price_usdc_must_have_up_to_6_decimals");

const createSchema = z.object({
  provider_id: uint256StringSchema("provider_id"),
  name: z.string().min(1),
  description: z.string().optional(),
  owner_wallet: evmAddressSchema("owner_wallet"),
  payout_wallet: evmAddressSchema("payout_wallet"),
  api_base_url: z.string().url(),
  trust_level: z.enum(["UNVERIFIED", "VERIFIED", "CERTIFIED", "HOSTED"]).optional(),
  service_type: z.string().min(1),
  input_schema: z.unknown().optional(),
  output_schema: z.unknown().optional(),
  price_usdc: usdcAmountSchema,
  max_concurrent_jobs: z.number().int().positive(),
  timeout_seconds: z.number().int().positive().optional(),
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
  service_type: z.string(),
  input_schema: z.unknown().nullable(),
  output_schema: z.unknown().nullable(),
  price_usdc: z.string(),
  max_concurrent_jobs: z.number(),
  timeout_seconds: z.number().nullable(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const preparedTransactionResponseSchema = z.object({
  to: z.string(),
  data: z.string(),
  value: z.literal("0"),
  from: z.string().optional(),
  chain_id: z.number().optional(),
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
      summary: "Get a provider by ID",
      params: idParamsSchema,
      response: {
        200: providerResponseSchema,
        404: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) return sendZodError(reply, params.error);
    const provider = await prisma.provider.findUnique({
      where: { provider_id: params.data.id },
    });
    if (!provider) return notFound(reply);
    return reply.send(serializeProvider(provider));
  });

  app.post("/providers", {
    schema: {
      tags: ["Providers"],
      summary: "Register a new provider",
      body: createSchema,
      response: {
        201: preparedTransactionResponseSchema,
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        409: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    agentHubRegistryAddress();
    const provider = await prisma.provider.create({
      data: {
        ...parsed.data,
        input_schema: parsed.data.input_schema as Prisma.InputJsonValue ?? undefined,
        output_schema: parsed.data.output_schema as Prisma.InputJsonValue ?? undefined,
      },
    });
    return reply.status(201).send(buildRegisterProviderCall(serializeProvider(provider)).transaction);
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
      data: {
        ...parsed.data,
        input_schema: parsed.data.input_schema as Prisma.InputJsonValue ?? undefined,
        output_schema: parsed.data.output_schema as Prisma.InputJsonValue ?? undefined,
      },
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
