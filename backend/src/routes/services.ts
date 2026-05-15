import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { serializeService } from "../lib/serialize.js";
import { notFound, sendZodError } from "../lib/http-errors.js";

const createSchema = z.object({
  provider_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  service_type: z.string().min(1),
  endpoint_path: z.string().min(1),
  input_schema: z.unknown().optional(),
  output_schema: z.unknown().optional(),
  price_usdc: z.number().positive(),
  timeout_seconds: z.number().int().positive().optional(),
  status: z.enum(["REGISTERED", "ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
});

const updateSchema = createSchema.omit({ provider_id: true }).partial();

export async function servicesRoutes(app: FastifyInstance) {
  app.get("/services", async (req, reply) => {
    const query = z
      .object({ provider_id: z.string().optional(), status: z.string().optional() })
      .safeParse(req.query);
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

  app.get<{ Params: { id: string } }>("/services/:id", async (req, reply) => {
    const service = await prisma.service.findUnique({
      where: { service_id: req.params.id },
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

  app.post("/services", async (req, reply) => {
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

  app.patch<{ Params: { id: string } }>("/services/:id", async (req, reply) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const existing = await prisma.service.findUnique({
      where: { service_id: req.params.id },
    });
    if (!existing) return notFound(reply);
    const service = await prisma.service.update({
      where: { service_id: req.params.id },
      data: {
        ...parsed.data,
        input_schema: parsed.data.input_schema as Prisma.InputJsonValue ?? undefined,
        output_schema: parsed.data.output_schema as Prisma.InputJsonValue ?? undefined,
      },
    });
    return reply.send(serializeService(service));
  });

  app.delete<{ Params: { id: string } }>("/services/:id", async (req, reply) => {
    const existing = await prisma.service.findUnique({
      where: { service_id: req.params.id },
    });
    if (!existing) return notFound(reply);
    await prisma.service.delete({ where: { service_id: req.params.id } });
    return reply.status(204).send();
  });
}
