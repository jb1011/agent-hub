import { arcTestnet } from "viem/chains";

export type AuthChallenge = {
  challenge_id: string;
  domain: string;
  uri: string;
  wallet_address: string;
  chain_id: number;
  nonce: string;
  issued_at: string;
  expires_at: string;
  statement: string;
};

export type TokenResponse = {
  access_token: string;
  expires_in: number;
};

export type MeResponse = {
  user_id: string;
  wallet_address: string;
  session_id: string;
  status: string;
};

export type StoredAuth = {
  accessToken: string;
  expiresAt: number;
  walletAddress: string;
};

export const AUTH_STORAGE_KEY = "skillhub_auth";

/** Buffer before expiry when we proactively refresh the access token. */
export const TOKEN_REFRESH_BUFFER_MS = 30_000;

export function authChainId(): number {
  const raw = process.env.NEXT_PUBLIC_AUTH_CHAIN_ID;
  if (!raw) return arcTestnet.id;
  const chainId = Number(raw);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("NEXT_PUBLIC_AUTH_CHAIN_ID must be a positive integer");
  }
  return chainId;
}

export function buildSiweMessage(challenge: AuthChallenge): string {
  return [
    `${challenge.domain} wants you to sign in with your Ethereum account:`,
    challenge.wallet_address,
    "",
    challenge.statement,
    "",
    `URI: ${challenge.uri}`,
    "Version: 1",
    `Chain ID: ${challenge.chain_id}`,
    `Nonce: ${challenge.nonce}`,
    `Issued At: ${challenge.issued_at}`,
    `Expiration Time: ${challenge.expires_at}`,
  ].join("\n");
}

export function readStoredAuth(): StoredAuth | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAuth;
    if (
      typeof parsed.accessToken !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.walletAddress !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredAuth(auth: StoredAuth | null): void {
  if (typeof window === "undefined") return;
  if (!auth) {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    return;
  }
  sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
}

export function isTokenFresh(expiresAt: number, now = Date.now()): boolean {
  return expiresAt - now > TOKEN_REFRESH_BUFFER_MS;
}

async function authFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Auth error ${res.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}

export async function requestAuthChallenge(
  walletAddress: string,
  chainId = authChainId(),
): Promise<AuthChallenge> {
  return authFetch<AuthChallenge>("/api/auth/wallet/challenge", {
    method: "POST",
    body: JSON.stringify({
      wallet_address: walletAddress,
      chain_id: chainId,
    }),
  });
}

export async function completeWalletLogin(input: {
  challenge_id: string;
  message: string;
  signature: string;
}): Promise<TokenResponse> {
  return authFetch<TokenResponse>("/api/auth/wallet/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function refreshAccessToken(): Promise<TokenResponse> {
  return authFetch<TokenResponse>("/api/auth/refresh", { method: "POST" });
}

export async function logoutSession(): Promise<void> {
  await authFetch<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
}

export async function fetchMe(accessToken: string): Promise<MeResponse> {
  const res = await fetch("/api/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Auth error ${res.status}: ${text}`);
  }
  return JSON.parse(text) as MeResponse;
}

export function tokenResponseToStored(
  token: TokenResponse,
  walletAddress: string,
): StoredAuth {
  return {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    walletAddress,
  };
}
