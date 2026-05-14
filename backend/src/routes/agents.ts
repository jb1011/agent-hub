import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { parseMicroUsdc } from "../lib/micro-usdc.js";
import { serializeAgent, serializeAgentVersion, serializeReview } from "../lib/serialize.js";
import { conflict, forbidden, notFound, sendZodError } from "../lib/http-errors.js";
import {
  createAgentBody,
  listAgentsQuery,
  updateAgentBody,
} from "../validation/schemas.js";

function jsonField(
  value: unknown | null | undefined
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function agentSnapshot(agent: {
  slug: string;
  title: string;
  description: string;
  category: string;
  priceMicroUsdc: bigint;
  billingType: string;
  endpointUrl: string | null;
  mcpMetadata: Prisma.JsonValue | null;
}): Prisma.InputJsonValue {
  return {
    slug: agent.slug,
    title: agent.title,
    description: agent.description,
    category: agent.category,
    priceMicroUsdc: agent.priceMicroUsdc.toString(),
    billingType: agent.billingType,
    endpointUrl: agent.endpointUrl,
    mcpMetadata: agent.mcpMetadata,
  };
}

export const agentsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/agents", async (request, reply) => {
    const parsed = listAgentsQuery.safeParse(request.query);
    if (!parsed.success) return sendZodError(reply, parsed.error);

    const { status, category, builderId } = parsed.data;

    const where: Prisma.AgentWhereInput = {};
    if (builderId) {
      where.builderId = builderId;
      if (status) where.status = status;
    } else {
      where.status = "published";
      if (category) where.category = category;
    }

    const agents = await prisma.agent.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    });
    return agents.map(serializeAgent);
  });

  app.get("/api/agents/by-slug/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const agent = await prisma.agent.findUnique({ where: { slug } });
    if (!agent) return notFound(reply, "agent_not_found");
    return serializeAgent(agent);
  });

  app.get("/api/agents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const agent = await prisma.agent.findUnique({ where: { id } });
    if (!agent) return notFound(reply, "agent_not_found");
    return serializeAgent(agent);
  });

  app.post("/api/agents", async (request, reply) => {
    const parsed = createAgentBody.safeParse(request.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);

    const data = parsed.data;
    const priceMicroUsdc = parseMicroUsdc(data.priceMicroUsdc);

    const builder = await prisma.user.findUnique({ where: { id: data.builderId } });
    if (!builder) return notFound(reply, "builder_not_found");
    if (builder.role !== "builder" && builder.role !== "admin") {
      return forbidden(reply, "user_must_be_builder_or_admin");
    }

    try {
      const agent = await prisma.agent.create({
        data: {
          builderId: data.builderId,
          slug: data.slug,
          title: data.title,
          description: data.description,
          category: data.category,
          priceMicroUsdc,
          billingType: data.billingType,
          endpointUrl: data.endpointUrl ?? null,
          mcpMetadata: jsonField(data.mcpMetadata),
        },
      });
      return reply.status(201).send(serializeAgent(agent));
    } catch (e: unknown) {
      if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002") {
        return conflict(reply, "slug_already_exists");
      }
      throw e;
    }
  });

  app.patch("/api/agents/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateAgentBody.safeParse(request.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);

    const existing = await prisma.agent.findUnique({ where: { id } });
    if (!existing) return notFound(reply, "agent_not_found");
    if (existing.status === "archived") return conflict(reply, "agent_archived");

    const updateData: Prisma.AgentUpdateInput = {};
    const d = parsed.data;
    if (d.title !== undefined) updateData.title = d.title;
    if (d.description !== undefined) updateData.description = d.description;
    if (d.category !== undefined) updateData.category = d.category;
    if (d.priceMicroUsdc !== undefined) updateData.priceMicroUsdc = parseMicroUsdc(d.priceMicroUsdc);
    if (d.billingType !== undefined) updateData.billingType = d.billingType;
    if (d.endpointUrl !== undefined) updateData.endpointUrl = d.endpointUrl;
    if (d.mcpMetadata !== undefined) updateData.mcpMetadata = jsonField(d.mcpMetadata);

    const agent = await prisma.agent.update({
      where: { id },
      data: updateData,
    });
    return serializeAgent(agent);
  });

  app.post("/api/agents/:id/publish", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { builderId?: string } | undefined;
    const builderId = body?.builderId;
    if (!builderId || typeof builderId !== "string") {
      return reply.status(400).send({ error: "builderId_required" });
    }

    const agent = await prisma.agent.findUnique({ where: { id } });
    if (!agent) return notFound(reply, "agent_not_found");
    if (agent.builderId !== builderId) return forbidden(reply, "not_agent_owner");
    if (agent.status !== "draft") return conflict(reply, "agent_not_in_draft");

    const last = await prisma.agentVersion.findFirst({
      where: { agentId: id },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (last?.version ?? 0) + 1;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.agentVersion.create({
        data: {
          agentId: id,
          version: nextVersion,
          snapshot: agentSnapshot(agent),
        },
      });
      return tx.agent.update({
        where: { id },
        data: {
          status: "published",
          publishedAt: new Date(),
        },
      });
    });

    return serializeAgent(updated);
  });

  app.get("/api/agents/:id/versions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const agent = await prisma.agent.findUnique({ where: { id }, select: { id: true } });
    if (!agent) return notFound(reply, "agent_not_found");
    const versions = await prisma.agentVersion.findMany({
      where: { agentId: id },
      orderBy: { version: "desc" },
    });
    return versions.map(serializeAgentVersion);
  });

  app.get("/api/agents/:id/reviews", async (request, reply) => {
    const { id } = request.params as { id: string };
    const agent = await prisma.agent.findUnique({ where: { id }, select: { id: true } });
    if (!agent) return notFound(reply, "agent_not_found");

    const reviews = await prisma.review.findMany({
      where: { agentId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return reviews.map(serializeReview);
  });
};
