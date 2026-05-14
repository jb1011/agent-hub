import type { Agent, Job, Review, User, UsageEvent, AgentVersion } from "@prisma/client";
import { microUsdcToString } from "./micro-usdc.js";

export function serializeUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    wallet: u.wallet,
    displayName: u.displayName,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

export function serializeAgent(a: Agent) {
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    description: a.description,
    category: a.category,
    builderId: a.builderId,
    status: a.status,
    priceMicroUsdc: microUsdcToString(a.priceMicroUsdc),
    billingType: a.billingType,
    endpointUrl: a.endpointUrl,
    mcpMetadata: a.mcpMetadata,
    avgRating: a.avgRating,
    reviewCount: a.reviewCount,
    publishedAt: a.publishedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export function serializeJob(j: Job) {
  return {
    id: j.id,
    agentId: j.agentId,
    buyerId: j.buyerId,
    status: j.status,
    amountMicroUsdc: microUsdcToString(j.amountMicroUsdc),
    idempotencyKey: j.idempotencyKey,
    contractRef: j.contractRef,
    onchainJobId: j.onchainJobId,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

export function serializeReview(r: Review) {
  return {
    id: r.id,
    agentId: r.agentId,
    userId: r.userId,
    jobId: r.jobId,
    rating: r.rating,
    text: r.text,
    createdAt: r.createdAt.toISOString(),
  };
}

export function serializeUsageEvent(e: UsageEvent) {
  return {
    id: e.id,
    jobId: e.jobId,
    latencyMs: e.latencyMs,
    error: e.error,
    toolName: e.toolName,
    createdAt: e.createdAt.toISOString(),
  };
}

export function serializeAgentVersion(v: AgentVersion) {
  return {
    id: v.id,
    agentId: v.agentId,
    version: v.version,
    snapshot: v.snapshot,
    createdAt: v.createdAt.toISOString(),
  };
}
