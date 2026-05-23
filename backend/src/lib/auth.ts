import { createHash, createHmac, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./prisma.js";

export type AuthenticatedUser = {
  id: string;
  walletAddress: string;
  sessionId: string;
};

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

const REFRESH_TOKEN_COOKIE_NAME = "refresh_token";
const JWT_ALGORITHM = "HS256";

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) return fallback;
  return value;
}

function requiredSecret(name: string): Uint8Array {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name}_is_required`);
  }
  return new TextEncoder().encode(value);
}

export function accessTokenTtlSeconds(): number {
  return positiveIntegerFromEnv("ACCESS_TOKEN_TTL_SECONDS", 900);
}

export function refreshTokenTtlDays(): number {
  return positiveIntegerFromEnv("REFRESH_TOKEN_TTL_DAYS", 30);
}

export function authChallengeTtlSeconds(): number {
  return positiveIntegerFromEnv("AUTH_CHALLENGE_TTL_SECONDS", 300);
}

export function authDomain(): string {
  return process.env.AUTH_DOMAIN?.trim() || "localhost";
}

export function authUri(): string {
  return process.env.AUTH_URI?.trim() || "http://localhost:3000";
}

export function cookieSecure(): boolean {
  const raw = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return process.env.NODE_ENV === "production";
}

export function refreshTokenExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + refreshTokenTtlDays() * 24 * 60 * 60 * 1000);
}

export function generateRefreshToken(): string {
  return `rt_${randomBytes(32).toString("base64url")}`;
}

export function hashRefreshToken(token: string): string {
  const secret = process.env.REFRESH_TOKEN_HASH_SECRET?.trim();
  if (secret) {
    return createHmac("sha256", secret).update(token).digest("hex");
  }
  return createHash("sha256").update(token).digest("hex");
}

export function hashIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  const secret = process.env.REFRESH_TOKEN_HASH_SECRET?.trim();
  if (secret) {
    return createHmac("sha256", secret).update(ip).digest("hex");
  }
  return createHash("sha256").update(ip).digest("hex");
}

export async function signAccessToken(params: {
  userId: string;
  walletAddress: string;
  sessionId: string;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const expiresIn = accessTokenTtlSeconds();
  const token = await new SignJWT({
    wallet: params.walletAddress,
    session_id: params.sessionId,
    role: "USER",
  })
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setSubject(params.userId)
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(requiredSecret("JWT_SECRET"));

  return { accessToken: token, expiresIn };
}

export async function verifyAccessToken(token: string): Promise<{
  userId: string;
  walletAddress: string;
  sessionId: string;
}> {
  const { payload } = await jwtVerify(token, requiredSecret("JWT_SECRET"), {
    algorithms: [JWT_ALGORITHM],
  });

  if (
    typeof payload.sub !== "string" ||
    typeof payload.wallet !== "string" ||
    typeof payload.session_id !== "string" ||
    payload.role !== "USER"
  ) {
    throw new Error("invalid_access_token");
  }

  return {
    userId: payload.sub,
    walletAddress: payload.wallet,
    sessionId: payload.session_id,
  };
}

export function setRefreshTokenCookie(reply: FastifyReply, refreshToken: string): void {
  reply.setCookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/auth",
    maxAge: refreshTokenTtlDays() * 24 * 60 * 60,
  });
}

export function clearRefreshTokenCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/auth",
  });
}

export function getRefreshTokenCookie(req: FastifyRequest): string | undefined {
  return req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
}

export async function requireUserAuth(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return reply.status(401).send({ error: "unauthorized" });
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return reply.status(401).send({ error: "unauthorized" });
  }

  try {
    const payload = await verifyAccessToken(token);
    const session = await prisma.userSession.findUnique({
      where: { id: payload.sessionId },
      include: { user: true },
    });

    if (
      !session ||
      session.revoked_at ||
      session.expires_at.getTime() <= Date.now() ||
      session.user.status !== "ACTIVE" ||
      session.user.id !== payload.userId ||
      session.user.wallet_address !== payload.walletAddress
    ) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    req.user = {
      id: session.user.id,
      walletAddress: session.user.wallet_address,
      sessionId: session.id,
    };
  } catch {
    return reply.status(401).send({ error: "unauthorized" });
  }
}
