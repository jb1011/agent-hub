import type { FastifyReply, FastifyRequest } from "fastify";
import { getAddress, isAddress, keccak256, toUtf8Bytes, verifyMessage } from "ethers";
import { Prisma, type Provider } from "@prisma/client";
import { isBytes32 } from "./create-job-authorization.js";
import { prisma } from "./prisma.js";
import { isUint256String } from "./uint256.js";

type AuthenticatedProvider = Pick<Provider, "request_id" | "registry_provider_id" | "signer_wallet">;

type ProviderRequestAuthResult =
  | { ok: true }
  | { ok: false; reply: FastifyReply };

type RawBodyRequest = FastifyRequest & {
  rawBody?: string;
};

const REQUIRED_PROVIDER_AUTH_HEADERS = [
  "x-provider-id",
  "x-provider-address",
  "x-timestamp",
  "x-body-hash",
  "x-signature",
  "x-nonce",
  "x-query-hash",
] as const;

const DEFAULT_PROVIDER_REQUEST_AUTH_MAX_AGE_SECONDS = 300;

export function hashProviderRequestPart(value: string): string {
  return keccak256(toUtf8Bytes(value));
}

export function buildProviderRequestMessage(params: {
  providerId: string;
  providerAddress: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
  queryHash: string;
}): string {
  return [
    "SkillHub Provider Request",
    `providerId:${params.providerId}`,
    `providerAddress:${params.providerAddress}`,
    `timestamp:${params.timestamp}`,
    `nonce:${params.nonce}`,
    `bodyHash:${params.bodyHash}`,
    `queryHash:${params.queryHash}`,
  ].join("\n");
}

function header(req: FastifyRequest, name: string): string | null {
  const value = req.headers[name];
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function getProviderIdHeader(req: FastifyRequest): string | null {
  return header(req, "x-provider-id");
}

function rawQuery(req: FastifyRequest): string {
  const rawUrl = req.raw.url ?? req.url;
  const queryStart = rawUrl.indexOf("?");
  return queryStart === -1 ? "" : rawUrl.slice(queryStart + 1);
}

function rawBody(req: FastifyRequest): string {
  const request = req as RawBodyRequest;
  if (typeof request.rawBody === "string") return request.rawBody;
  if (req.body === undefined) return "";
  return JSON.stringify(req.body);
}

function providerIdMatches(provider: AuthenticatedProvider, providerId: string): boolean {
  return providerId === provider.request_id || providerId === provider.registry_provider_id;
}

function isValidProviderId(providerId: string): boolean {
  return isBytes32(providerId) || isUint256String(providerId);
}

function maxAgeSeconds(): number {
  const raw = process.env.PROVIDER_REQUEST_AUTH_MAX_AGE_SECONDS?.trim();
  if (!raw) return DEFAULT_PROVIDER_REQUEST_AUTH_MAX_AGE_SECONDS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) return DEFAULT_PROVIDER_REQUEST_AUTH_MAX_AGE_SECONDS;
  return value;
}

function timestampMs(timestampHeader: string): number | "invalid" {
  const timestamp = Number(timestampHeader);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return "invalid";

  return timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
}

function validateTimestamp(timestampHeader: string, now = Date.now()):
  | { ok: true; timestampMs: number; expiresAt: Date }
  | { ok: false; error: "timestamp_invalid" | "timestamp_in_future" | "timestamp_expired" } {
  const parsedTimestampMs = timestampMs(timestampHeader);
  if (parsedTimestampMs === "invalid") return { ok: false, error: "timestamp_invalid" };
  if (parsedTimestampMs > now) return { ok: false, error: "timestamp_in_future" };

  const expiresAtMs = parsedTimestampMs + maxAgeSeconds() * 1000;
  if (expiresAtMs <= now) return { ok: false, error: "timestamp_expired" };

  return { ok: true, timestampMs: parsedTimestampMs, expiresAt: new Date(expiresAtMs) };
}

function sameHash(actual: string, expected: string): boolean {
  return actual.toLowerCase() === expected.toLowerCase();
}

async function reserveProviderNonce(
  providerRequestId: string,
  nonce: string,
  expiresAt: Date
): Promise<"ok" | "replayed" | "failed"> {
  try {
    await prisma.providerRequestNonce.deleteMany({
      where: {
        provider_request_id: providerRequestId,
        expires_at: { lte: new Date() },
      },
    });
    await prisma.providerRequestNonce.create({
      data: {
        provider_request_id: providerRequestId,
        nonce,
        expires_at: expiresAt,
      },
    });
    return "ok";
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return "replayed";
    }
    return "failed";
  }
}

export async function verifyProviderRequestHeaders(
  req: FastifyRequest,
  reply: FastifyReply,
  provider: AuthenticatedProvider,
  options: { providerIdMismatchError?: string } = {}
): Promise<ProviderRequestAuthResult> {
  for (const name of REQUIRED_PROVIDER_AUTH_HEADERS) {
    if (!header(req, name)) {
      return { ok: false, reply: reply.status(401).send({ error: `missing_header_${name}` }) };
    }
  }

  const providerId = header(req, "x-provider-id")!;
  const providerAddressHeader = header(req, "x-provider-address")!;
  const timestamp = header(req, "x-timestamp")!;
  const bodyHash = header(req, "x-body-hash")!;
  const signature = header(req, "x-signature")!;
  const nonce = header(req, "x-nonce")!;
  const queryHash = header(req, "x-query-hash")!;

  if (!isValidProviderId(providerId)) {
    return { ok: false, reply: reply.status(400).send({ error: "provider_id_invalid" }) };
  }
  if (!providerIdMatches(provider, providerId)) {
    return {
      ok: false,
      reply: reply.status(403).send({
        error: options.providerIdMismatchError ?? "provider_id_does_not_match_job",
      }),
    };
  }
  if (!isAddress(providerAddressHeader)) {
    return { ok: false, reply: reply.status(400).send({ error: "provider_address_must_be_evm_address" }) };
  }

  const providerAddress = getAddress(providerAddressHeader);
  const signerWallet = getAddress(provider.signer_wallet);
  if (providerAddress !== signerWallet) {
    return { ok: false, reply: reply.status(403).send({ error: "provider_address_does_not_match_signer" }) };
  }

  const timestampState = validateTimestamp(timestamp);
  if (!timestampState.ok) {
    const status = timestampState.error === "timestamp_invalid" ? 400 : 401;
    return { ok: false, reply: reply.status(status).send({ error: timestampState.error }) };
  }

  const actualBodyHash = hashProviderRequestPart(rawBody(req));
  if (!sameHash(actualBodyHash, bodyHash)) {
    return { ok: false, reply: reply.status(401).send({ error: "body_hash_mismatch" }) };
  }

  const actualQueryHash = hashProviderRequestPart(rawQuery(req));
  if (!sameHash(actualQueryHash, queryHash)) {
    return { ok: false, reply: reply.status(401).send({ error: "query_hash_mismatch" }) };
  }

  const message = buildProviderRequestMessage({
    providerId,
    providerAddress,
    timestamp,
    nonce,
    bodyHash,
    queryHash,
  });

  try {
    const recovered = getAddress(verifyMessage(message, signature));
    if (recovered !== signerWallet) {
      return { ok: false, reply: reply.status(401).send({ error: "signature_signer_mismatch" }) };
    }
  } catch {
    return { ok: false, reply: reply.status(401).send({ error: "signature_invalid" }) };
  }

  const nonceState = await reserveProviderNonce(provider.request_id, nonce, timestampState.expiresAt);
  if (nonceState === "replayed") {
    return { ok: false, reply: reply.status(401).send({ error: "nonce_replayed" }) };
  }
  if (nonceState === "failed") {
    return { ok: false, reply: reply.status(500).send({ error: "nonce_reservation_failed" }) };
  }

  return { ok: true };
}
