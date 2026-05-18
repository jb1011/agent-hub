import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { serializeService } from "../lib/serialize.js";
import { notFound, sendZodError } from "../lib/http-errors.js";
import { uint256StringSchema } from "../lib/uint256.js";

const createSchema = z.object({
  service_id: uint256StringSchema("service_id"),
  provider_id: uint256StringSchema("provider_id"),
  name: z.string().min(1),
  description: z.string().optional(),
  service_type: z.string().min(1),
  endpoint_path: z.string().min(1),
  input_schema: z.unknown().optional(),
  output_schema: z.unknown().optional(),
  price_usdc: z.number().positive(),
  max_concurrent_jobs: z.number().int().positive(),
  timeout_seconds: z.number().int().positive().optional(),
  status: z.enum(["REGISTERED", "ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
});

const updateSchema = createSchema.omit({ service_id: true, provider_id: true }).partial();

const idParamsSchema = z.object({
  id: uint256StringSchema("service_id"),
});

const serviceResponseSchema = z.object({
  service_id: z.string(),
  provider_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  service_type: z.string(),
  endpoint_path: z.string(),
  input_schema: z.unknown().nullable(),
  output_schema: z.unknown().nullable(),
  price_usdc: z.string(),
  max_concurrent_jobs: z.number(),
  timeout_seconds: z.number().nullable(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const listQuerySchema = z.object({
  provider_id: uint256StringSchema("provider_id").optional(),
  status: z.string().optional(),
});

export async function servicesRoutes(app: FastifyInstance) {
  app.get("/services", {
    schema: {
      tags: ["Services"],
      summary: "List services (optionally filter by provider or status)",
      querystring: listQuerySchema,
      response: { 200: z.array(serviceResponseSchema) },
    },
  }, async (req, reply) => {
    const query = listQuerySchema.safeParse(req.query);
    if (!query.success) return sendZodError(reply, query.error);
    const where = query.success
      ? {
          ...(query.data.provider_id ? { provider_id: query.data.provider_id } : {}),
          ...(query.data.status ? { status: query.data.status as never } : {}),
        }
      : {};
    const services = await prisma.service.findMany({
      where,
      orderBy: { created_at: "desc" },
    });
    return reply.send(services.map(serializeService));
  });

  app.get<{ Params: { id: string } }>("/services/:id", {
    schema: {
      tags: ["Services"],
      summary: "Get a service by ID (includes provider info)",
      params: idParamsSchema,
      response: {
        200: serviceResponseSchema.extend({
          provider: z.object({
            provider_id: z.string(),
            name: z.string(),
            trust_level: z.string(),
          }),
        }),
        404: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) return sendZodError(reply, params.error);
    const service = await prisma.service.findUnique({
      where: { service_id: params.data.id },
      include: { provider: true },
    });
    if (!service) return notFound(reply);
    return reply.send({
      ...serializeService(service),
      provider: {
        provider_id: service.provider.provider_id,
        name: service.provider.name,
        trust_level: service.provider.trust_level,
      },
    });
  });

  app.post("/services", {
    schema: {
      tags: ["Services"],
      summary: "Register a new service",
      body: createSchema,
      response: {
        201: serviceResponseSchema,
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        404: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const providerExists = await prisma.provider.findUnique({
      where: { provider_id: parsed.data.provider_id },
    });
    if (!providerExists) return notFound(reply, "provider_not_found");
    const service = await prisma.service.create({
      data: {
        ...parsed.data,
        input_schema: parsed.data.input_schema as Prisma.InputJsonValue ?? undefined,
        output_schema: parsed.data.output_schema as Prisma.InputJsonValue ?? undefined,
      },
    });
    return reply.status(201).send(serializeService(service));
  });

  app.patch<{ Params: { id: string } }>("/services/:id", {
    schema: {
      tags: ["Services"],
      summary: "Update a service",
      params: idParamsSchema,
      body: updateSchema,
      response: {
        200: serviceResponseSchema,
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        404: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) return sendZodError(reply, params.error);
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const existing = await prisma.service.findUnique({
      where: { service_id: params.data.id },
    });
    if (!existing) return notFound(reply);
    const service = await prisma.service.update({
      where: { service_id: params.data.id },
      data: {
        ...parsed.data,
        input_schema: parsed.data.input_schema as Prisma.InputJsonValue ?? undefined,
        output_schema: parsed.data.output_schema as Prisma.InputJsonValue ?? undefined,
      },
    });
    return reply.send(serializeService(service));
  });

  app.delete<{ Params: { id: string } }>("/services/:id", {
    schema: {
      tags: ["Services"],
      summary: "Delete a service",
      params: idParamsSchema,
      response: {
        204: z.null(),
        404: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) return sendZodError(reply, params.error);
    const existing = await prisma.service.findUnique({
      where: { service_id: params.data.id },
    });
    if (!existing) return notFound(reply);
    await prisma.service.delete({ where: { service_id: params.data.id } });
    return reply.status(204).send();
  });
}
