import { z } from "zod";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createUserBody = z.object({
  email: z.string().email().optional(),
  wallet: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  displayName: z.string().min(1).max(120).optional(),
  role: z.enum(["user", "builder", "admin"]).optional(),
}).refine((d) => d.email != null || d.wallet != null, {
  message: "email or wallet is required",
});

export const createAgentBody = z.object({
  builderId: z.string().min(1),
  slug: z.string().min(2).max(64).regex(slugRegex),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(10_000),
  category: z.string().min(1).max(64),
  priceMicroUsdc: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
  billingType: z.enum(["per_call", "per_job"]),
  endpointUrl: z.string().url().optional().nullable(),
  mcpMetadata: z.any().optional().nullable(),
});

export const updateAgentBody = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(10_000).optional(),
  category: z.string().min(1).max(64).optional(),
  priceMicroUsdc: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).optional(),
  billingType: z.enum(["per_call", "per_job"]).optional(),
  endpointUrl: z.string().url().optional().nullable(),
  mcpMetadata: z.any().optional().nullable(),
});

export const listAgentsQuery = z.object({
  status: z.enum(["draft", "published", "archived"]).optional(),
  category: z.string().optional(),
  builderId: z.string().optional(),
});

export const createJobBody = z.object({
  agentId: z.string().min(1),
  buyerId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const confirmJobPaymentBody = z.object({
  contractRef: z.string().min(1).max(200).optional(),
  onchainJobId: z.string().max(128).optional(),
});

export const patchJobBody = z.object({
  status: z.enum(["in_progress", "completed", "failed", "cancelled"]),
});

export const createReviewBody = z.object({
  jobId: z.string().min(1),
  userId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  text: z.string().max(5000).optional().nullable(),
});

export const createUsageEventBody = z.object({
  latencyMs: z.number().int().nonnegative().optional().nullable(),
  error: z.string().max(2000).optional().nullable(),
  toolName: z.string().max(256).optional().nullable(),
});
