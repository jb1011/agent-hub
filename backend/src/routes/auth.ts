import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { getAddress, isAddress } from "ethers";
import { generateNonce, SiweMessage } from "siwe";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { sendZodError } from "../lib/http-errors.js";
import {
  authChallengeTtlSeconds,
  authDomain,
  authUri,
  clearRefreshTokenCookie,
  generateRefreshToken,
  getRefreshTokenCookie,
  hashIp,
  hashRefreshToken,
  refreshTokenExpiresAt,
  requireUserAuth,
  setRefreshTokenCookie,
  signAccessToken,
} from "../lib/auth.js";

const challengeSchema = z.object({
  wallet_address: z.string().refine(isAddress, "wallet_address_must_be_evm_address"),
  chain_id: z.number().int().positive(),
});

const loginSchema = z.object({
  challenge_id: z.string().min(1),
  message: z.string().min(1),
  signature: z.string().min(1),
});

const challengeResponseSchema = z.object({
  challenge_id: z.string(),
  domain: z.string(),
  uri: z.string(),
  wallet_address: z.string(),
  chain_id: z.number(),
  nonce: z.string(),
  issued_at: z.string(),
  expires_at: z.string(),
  statement: z.string(),
});

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});

const okResponseSchema = z.object({
  ok: z.boolean(),
});

const meResponseSchema = z.object({
  user_id: z.string(),
  wallet_address: z.string(),
  session_id: z.string(),
  status: z.string(),
});

class UnauthorizedAuthError extends Error {
  constructor() {
    super("unauthorized");
  }
}

function normalizeWalletAddress(address: string): string {
  return getAddress(address);
}

function userAgentFromHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

function assertSiweMatchesChallenge(siweMessage: SiweMessage, challenge: {
  wallet_address: string;
  chain_id: bigint;
  nonce: string;
  domain: string;
  uri: string;
  statement: string;
  issued_at: Date;
  expires_at: Date;
}) {
  const messageAddress = normalizeWalletAddress(siweMessage.address);
  const chainId = Number(challenge.chain_id);

  if (
    messageAddress !== challenge.wallet_address ||
    siweMessage.domain !== challenge.domain ||
    siweMessage.uri !== challenge.uri ||
    siweMessage.version !== "1" ||
    siweMessage.chainId !== chainId ||
    siweMessage.nonce !== challenge.nonce ||
    siweMessage.statement !== challenge.statement ||
    siweMessage.issuedAt !== challenge.issued_at.toISOString() ||
    siweMessage.expirationTime !== challenge.expires_at.toISOString()
  ) {
    throw new UnauthorizedAuthError();
  }
}

function parseSiweMessage(message: string): SiweMessage {
  try {
    return new SiweMessage(message);
  } catch {
    throw new UnauthorizedAuthError();
  }
}

async function verifySiweSignature(siweMessage: SiweMessage, signature: string, challenge: {
  domain: string;
  nonce: string;
}) {
  let result: Awaited<ReturnType<SiweMessage["verify"]>>;
  try {
    result = await siweMessage.verify({
      signature,
      domain: challenge.domain,
      nonce: challenge.nonce,
    });
  } catch {
    throw new UnauthorizedAuthError();
  }

  if (!result.success) {
    throw new UnauthorizedAuthError();
  }
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/wallet/challenge", {
    schema: {
      tags: ["Auth"],
      summary: "Create a SIWE wallet login challenge",
      body: challengeSchema,
      response: {
        201: challengeResponseSchema,
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
      },
    },
  }, async (req, reply) => {
    const parsed = challengeSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);

    const walletAddress = normalizeWalletAddress(parsed.data.wallet_address);
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + authChallengeTtlSeconds() * 1000);
    const challenge = {
      id: randomUUID(),
      wallet_address: walletAddress,
      chain_id: BigInt(parsed.data.chain_id),
      nonce: generateNonce(),
      domain: authDomain(),
      uri: authUri(),
      statement: "Sign in to AgentHub.",
      issued_at: issuedAt,
      expires_at: expiresAt,
    };

    await prisma.authChallenge.create({ data: challenge });

    return reply.status(201).send({
      challenge_id: challenge.id,
      domain: challenge.domain,
      uri: challenge.uri,
      wallet_address: challenge.wallet_address,
      chain_id: parsed.data.chain_id,
      nonce: challenge.nonce,
      issued_at: challenge.issued_at.toISOString(),
      expires_at: challenge.expires_at.toISOString(),
      statement: challenge.statement,
    });
  });

  app.post("/auth/wallet/login", {
    schema: {
      tags: ["Auth"],
      summary: "Verify a SIWE signature and open a user session",
      body: loginSchema,
      response: {
        200: tokenResponseSchema,
        400: z.object({ error: z.string(), details: z.unknown().optional() }),
        401: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return sendZodError(reply, parsed.error);

    try {
      const result = await prisma.$transaction(async (db) => {
        const challenge = await db.authChallenge.findUnique({
          where: { id: parsed.data.challenge_id },
        });
        const now = new Date();
        if (!challenge || challenge.consumed_at || challenge.expires_at.getTime() <= now.getTime()) {
          throw new UnauthorizedAuthError();
        }

        const siweMessage = parseSiweMessage(parsed.data.message);
        assertSiweMatchesChallenge(siweMessage, challenge);
        await verifySiweSignature(siweMessage, parsed.data.signature, challenge);

        const consumed = await db.authChallenge.updateMany({
          where: {
            id: challenge.id,
            consumed_at: null,
            expires_at: { gt: now },
          },
          data: { consumed_at: now },
        });
        if (consumed.count !== 1) {
          throw new UnauthorizedAuthError();
        }

        const user = await db.user.upsert({
          where: { wallet_address: challenge.wallet_address },
          update: {},
          create: {
            id: randomUUID(),
            wallet_address: challenge.wallet_address,
            status: "ACTIVE",
          },
        });

        if (user.status !== "ACTIVE") {
          throw new UnauthorizedAuthError();
        }

        const refreshToken = generateRefreshToken();
        const session = await db.userSession.create({
          data: {
            id: randomUUID(),
            user_id: user.id,
            refresh_token_hash: hashRefreshToken(refreshToken),
            expires_at: refreshTokenExpiresAt(now),
            user_agent: userAgentFromHeader(req.headers["user-agent"]),
            ip_hash: hashIp(req.ip),
          },
        });

        const token = await signAccessToken({
          userId: user.id,
          walletAddress: user.wallet_address,
          sessionId: session.id,
        });

        return { token, refreshToken };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });

      setRefreshTokenCookie(reply, result.refreshToken);
      return reply.send({
        access_token: result.token.accessToken,
        expires_in: result.token.expiresIn,
      });
    } catch (err) {
      if (err instanceof UnauthorizedAuthError) {
        return reply.status(401).send({ error: "unauthorized" });
      }
      throw err;
    }
  });

  app.post("/auth/refresh", {
    schema: {
      tags: ["Auth"],
      summary: "Rotate a refresh token and issue a new access token",
      response: {
        200: tokenResponseSchema,
        401: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    const refreshToken = getRefreshTokenCookie(req);
    if (!refreshToken) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    try {
      const result = await prisma.$transaction(async (db) => {
        const now = new Date();
        const currentHash = hashRefreshToken(refreshToken);
        const session = await db.userSession.findUnique({
          where: { refresh_token_hash: currentHash },
          include: { user: true },
        });

        if (
          !session ||
          session.revoked_at ||
          session.expires_at.getTime() <= now.getTime() ||
          session.user.status !== "ACTIVE"
        ) {
          throw new UnauthorizedAuthError();
        }

        const nextRefreshToken = generateRefreshToken();
        const updated = await db.userSession.updateMany({
          where: {
            id: session.id,
            refresh_token_hash: currentHash,
            revoked_at: null,
            expires_at: { gt: now },
          },
          data: {
            refresh_token_hash: hashRefreshToken(nextRefreshToken),
            last_used_at: now,
            expires_at: refreshTokenExpiresAt(now),
          },
        });
        if (updated.count !== 1) {
          throw new UnauthorizedAuthError();
        }

        const token = await signAccessToken({
          userId: session.user.id,
          walletAddress: session.user.wallet_address,
          sessionId: session.id,
        });

        return { token, refreshToken: nextRefreshToken };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });

      setRefreshTokenCookie(reply, result.refreshToken);
      return reply.send({
        access_token: result.token.accessToken,
        expires_in: result.token.expiresIn,
      });
    } catch (err) {
      if (err instanceof UnauthorizedAuthError) {
        return reply.status(401).send({ error: "unauthorized" });
      }
      throw err;
    }
  });

  app.post("/auth/logout", {
    schema: {
      tags: ["Auth"],
      summary: "Revoke the current refresh-token session",
      response: { 200: okResponseSchema },
    },
  }, async (req, reply) => {
    const refreshToken = getRefreshTokenCookie(req);
    if (refreshToken) {
      const refreshTokenHash = hashRefreshToken(refreshToken);
      await prisma.$transaction(async (db) => {
        const session = await db.userSession.findUnique({
          where: { refresh_token_hash: refreshTokenHash },
        });
        if (session && !session.revoked_at) {
          await db.userSession.update({
            where: { id: session.id },
            data: { revoked_at: new Date() },
          });
        }
      });
    }

    clearRefreshTokenCookie(reply);
    return reply.send({ ok: true });
  });

  app.get("/me", {
    preHandler: requireUserAuth,
    schema: {
      tags: ["Auth"],
      summary: "Get the authenticated user",
      response: {
        200: meResponseSchema,
        401: z.object({ error: z.string() }),
      },
    },
  }, async (req, reply) => {
    if (!req.user) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
    });
    if (!user || user.status !== "ACTIVE") {
      return reply.status(401).send({ error: "unauthorized" });
    }

    return reply.send({
      user_id: user.id,
      wallet_address: user.wallet_address,
      session_id: req.user.sessionId,
      status: user.status,
    });
  });
}
