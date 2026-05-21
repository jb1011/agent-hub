import type { FastifyInstance } from "fastify";
import { getAddress, isAddress } from "ethers";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { serializeProvider } from "../lib/serialize.js";
import { notFound, sendZodError } from "../lib/http-errors.js";
import { isBytes32 } from "../lib/create-job-authorization.js";
import { uint256StringSchema } from "../lib/uint256.js";
import { generateBytes32Id } from "../lib/bytes32-id.js";
import { agentHubRegistryAddress, buildRegisterProviderCall } from "../lib/registry-call.js";
import { RegisterProviderAuthorizationError } from "../lib/register-provider-authorization.js";

const evmAddressSchema = (fieldName: string) =>
  z.string().refine(isAddress, `${fieldName}_must_be_evm_address`);

const bytes32StringSchema = (fieldName: string) =>
  z.string().refine(isBytes32, `${fieldName}_must_be_bytes32`);

const usdcAmountSchema = z
  .number()
  .positive()
  .refine((value) => /^\d+(\.\d{1,6})?$/.test(value.toString()), "price_usdc_must_have_up_to_6_decimals");

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  owner_wallet: evmAddressSchema("owner_wallet"),
  payout_wallet: evmAddressSchema("payout_wallet"),
  api_base_url: z.string().url(),
  service_type: z.string().min(1),
  input_schema: z.unknown().optional(),
  output_schema: z.unknown().optional(),
  price_usdc: usdcAmountSchema,
  max_concurrent_jobs: z.number().int().positive(),
  timeout_seconds: z.number().int().positive().optional(),
  registry_provider_id: uint256StringSchema("registry_provider_id").optional(),
});

const updateSchema = createSchema.partial().extend({
  trust_level: z.enum(["UNVERIFIED", "VERIFIED", "CERTIFIED", "HOSTED"]).optional(),
  status: z.enum(["REGISTERED", "ACTIVE", "SUSPENDED"]).optional(),
});

const idParamsSchema = z.object({
  id: bytes32StringSchema("request_id"),
});

const providerResponseSchema = z.object({
  request_id: z.string(),
  registry_provider_id: z.string().nullable(),
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
  timeout_seconds: z.number().int().positive(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const preparedTransactionSchema = z.object({
  to: z.string(),
  data: z.string(),
  value: z.literal("0"),
  from: z.string().optional(),
  chain_id: z.number().optional(),
});

const createProviderResponseSchema = z.object({
  request_id: z.string(),
  transaction: preparedTransactionSchema,
});

type ProviderCreateInput = z.infer<typeof createSchema>;
type ProviderUpdateInput = z.infer<typeof updateSchema>;

function normalizeProviderAddresses<T extends ProviderCreateInput | ProviderUpdateInput>(data: T): T {
  return {
    ...data,
    ...(data.owner_wallet ? { owner_wallet: getAddress(data.owner_wallet) } : {}),
    ...(data.payout_wallet ? { payout_wallet: getAddress(data.payout_wallet) } : {}),
  };
}

async function generateUniqueProviderRequestId(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const requestId = generateBytes32Id();
    const existing = await prisma.provider.findUnique({ where: { request_id: requestId } });
    if (!existing) return requestId;
  }

  throw new Error("failed_to_generate_request_id");
}

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
      summary: "Get a provider by request_id",
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
      where: { request_id: params.data.id },
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
        201: createProviderResponseSchema,
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        409: z.object({ error: z.string() }),
        500: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const providerInput = normalizeProviderAddresses(parsed.data);
    agentHubRegistryAddress();

    let requestId: string;
    try {
      requestId = await generateUniqueProviderRequestId();
    } catch {
      return reply.status(500).send({ error: "failed_to_generate_request_id" });
    }

    let result: {
      provider: Awaited<ReturnType<typeof prisma.provider.update>>;
      prepared: Awaited<ReturnType<typeof buildRegisterProviderCall>>;
    };

    try {
      result = await prisma.$transaction(async (db) => {
        const provider = await db.provider.create({
          data: {
            request_id: requestId,
            status: "REGISTERED",
            trust_level: "UNVERIFIED",
            ...providerInput,
            input_schema: providerInput.input_schema as Prisma.InputJsonValue ?? undefined,
            output_schema: providerInput.output_schema as Prisma.InputJsonValue ?? undefined,
          },
        });
        const prepared = await buildRegisterProviderCall(serializeProvider(provider));
        const providerWithCommitment = await db.provider.update({
          where: { request_id: provider.request_id },
          data: {
            metadata_commitment: prepared.register_provider_args.metadata_commitment.toLowerCase(),
          },
        });
        return { provider: providerWithCommitment, prepared };
      });
    } catch (err) {
      if (err instanceof RegisterProviderAuthorizationError) {
        return reply.status(err.statusCode as 400 | 500).send({ error: err.message });
      }
      throw err;
    }

    return reply.status(201).send({
      request_id: result.provider.request_id,
      transaction: result.prepared.transaction,
    });
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
    const providerInput = normalizeProviderAddresses(parsed.data);
    const existing = await prisma.provider.findUnique({
      where: { request_id: params.data.id },
    });
    if (!existing) return notFound(reply);
    if (parsed.data.status === "ACTIVE") {
      const registryProviderId =
        parsed.data.registry_provider_id ?? existing.registry_provider_id;
      if (!registryProviderId) {
        return reply.status(409).send({ error: "provider_not_registered_onchain" });
      }
    }
    const provider = await prisma.provider.update({
      where: { request_id: params.data.id },
      data: {
        ...providerInput,
        input_schema: providerInput.input_schema as Prisma.InputJsonValue ?? undefined,
        output_schema: providerInput.output_schema as Prisma.InputJsonValue ?? undefined,
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
      where: { request_id: params.data.id },
    });
    if (!existing) return notFound(reply);
    await prisma.provider.delete({ where: { request_id: params.data.id } });
    return reply.status(204).send();
  });
}
