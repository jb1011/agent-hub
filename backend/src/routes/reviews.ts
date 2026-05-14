import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { serializeReview } from "../lib/serialize.js";
import { conflict, forbidden, notFound, sendZodError } from "../lib/http-errors.js";
import { createReviewBody } from "../validation/schemas.js";

export const reviewsRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/reviews", async (request, reply) => {
    const parsed = createReviewBody.safeParse(request.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);

    const { jobId, userId, rating, text } = parsed.data;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { agent: true },
    });
    if (!job) return notFound(reply, "job_not_found");
    if (job.buyerId !== userId) return forbidden(reply, "only_buyer_can_review");
    if (job.status !== "completed") return conflict(reply, "job_not_completed");

    try {
      const review = await prisma.$transaction(async (tx) => {
        const r = await tx.review.create({
          data: {
            agentId: job.agentId,
            userId,
            jobId,
            rating,
            text: text ?? null,
          },
        });

        const agg = await tx.review.aggregate({
          where: { agentId: job.agentId },
          _avg: { rating: true },
          _count: { _all: true },
        });

        await tx.agent.update({
          where: { id: job.agentId },
          data: {
            avgRating: agg._avg.rating ?? null,
            reviewCount: agg._count._all,
          },
        });

        return r;
      });

      return reply.status(201).send(serializeReview(review));
    } catch (e: unknown) {
      if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002") {
        return conflict(reply, "review_already_exists_for_job");
      }
      throw e;
    }
  });
};
