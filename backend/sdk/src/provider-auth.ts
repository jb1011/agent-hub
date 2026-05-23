import { keccak_256 } from "@noble/hashes/sha3";
import type { ProviderRequestAuthOptions, ProviderRequestHeaders } from "./types.js";

const PROVIDER_AUTH_ROUTES = [
  "/start-next-job-request",
  "/start-job",
  "/job-finish",
] as const;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** EIP-55 checksum (matches ethers getAddress for valid inputs). */
export function normalizeProviderAddress(address: string): string {
  if (!ADDRESS_RE.test(address)) {
    throw new Error("invalid_provider_address");
  }

  const lower = address.slice(2).toLowerCase();
  const hash = keccak_256(utf8Bytes(lower));
  let checksummed = "0x";

  for (let i = 0; i < 40; i++) {
    const hashByte = hash[Math.floor(i / 2)]!;
    const nibble = i % 2 === 0 ? hashByte >> 4 : hashByte & 0x0f;
    const char = lower[i]!;
    checksummed += nibble >= 8 ? char.toUpperCase() : char;
  }

  return checksummed;
}

export function isProviderAuthenticatedPath(path: string): boolean {
  const pathname = path.split("?")[0] ?? path;
  return PROVIDER_AUTH_ROUTES.some((suffix) => pathname.endsWith(suffix));
}

export function hashProviderRequestPart(value: string): string {
  const hash = keccak_256(utf8Bytes(value));
  return `0x${Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
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

function rawQuery(path: string): string {
  const queryStart = path.indexOf("?");
  return queryStart === -1 ? "" : path.slice(queryStart + 1);
}

function randomNonce(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function buildProviderRequestHeaders(params: {
  path: string;
  body: string;
  auth: ProviderRequestAuthOptions;
}): Promise<ProviderRequestHeaders> {
  const providerAddress = normalizeProviderAddress(params.auth.providerAddress);
  const timestamp = String(await params.auth.timestamp?.() ?? Math.floor(Date.now() / 1000));
  const nonce = String(await params.auth.nonce?.() ?? randomNonce());
  const bodyHash = hashProviderRequestPart(params.body);
  const queryHash = hashProviderRequestPart(rawQuery(params.path));
  const message = buildProviderRequestMessage({
    providerId: params.auth.providerId,
    providerAddress,
    timestamp,
    nonce,
    bodyHash,
    queryHash,
  });

  return {
    "X-Provider-Id": params.auth.providerId,
    "X-Provider-Address": providerAddress,
    "X-Timestamp": timestamp,
    "X-Body-Hash": bodyHash,
    "X-Signature": await params.auth.signMessage(message),
    "X-Nonce": nonce,
    "X-Query-Hash": queryHash,
  };
}
