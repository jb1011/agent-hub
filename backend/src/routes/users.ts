import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { serializeUser } from "../lib/serialize.js";
import { conflict, sendZodError } from "../lib/http-errors.js";
import { createUserBody } from "../validation/schemas.js";

const listUsersQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const usersRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/users", async (request, reply) => {
    const parsed = listUsersQuery.safeParse(request.query);
    if (!parsed.success) return sendZodError(reply, parsed.error);
    const limit = parsed.data.limit ?? 50;
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return users.map(serializeUser);
  });

  app.post("/api/users", async (request, reply) => {
    const parsed = createUserBody.safeParse(request.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);

    const { email, wallet, displayName, role } = parsed.data;

    try {
      const user = await prisma.user.create({
        data: {
          email: email ?? null,
          wallet: wallet?.toLowerCase() ?? null,
          displayName: displayName ?? null,
          role: role ?? "user",
        },
      });
      return reply.status(201).send(serializeUser(user));
    } catch (e: unknown) {
      if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002") {
        return conflict(reply, "email_or_wallet_already_exists");
      }
      throw e;
    }
  });

  app.get("/api/users/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return reply.status(404).send({ error: "user_not_found" });
    return serializeUser(user);
  });
};
