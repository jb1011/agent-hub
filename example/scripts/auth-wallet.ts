import { getAddress } from "ethers";
import { API_URL } from "../lib/sdk-client.ts";
import { signerWallet } from "../lib/transactions.ts";

type AuthChallenge = {
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

type TokenResponse = {
  access_token: string;
  expires_in: number;
};

type MeResponse = {
  user_id: string;
  wallet_address: string;
  session_id: string;
  status: string;
};

type CookieJar = Map<string, string>;

const chainId = Number(process.env.AUTH_CHAIN_ID ?? process.env.CHAIN_ID ?? "5042002");
if (!Number.isSafeInteger(chainId) || chainId <= 0) {
  throw new Error("AUTH_CHAIN_ID must be a positive integer when set");
}

const wallet = signerWallet();
const walletAddress = getAddress(wallet.address);
const cookieJar: CookieJar = new Map();

function buildSiweMessage(challenge: AuthChallenge): string {
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

function cookieHeader(jar: CookieJar): string | undefined {
  const cookies = [...jar.entries()].map(([name, value]) => `${name}=${value}`);
  return cookies.length > 0 ? cookies.join("; ") : undefined;
}

function setCookieHeaders(headers: Headers): string[] {
  const headersWithGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headersWithGetSetCookie.getSetCookie === "function") {
    return headersWithGetSetCookie.getSetCookie();
  }

  const header = headers.get("set-cookie");
  return header ? [header] : [];
}

function storeSetCookies(jar: CookieJar, headers: Headers): void {
  for (const setCookie of setCookieHeaders(headers)) {
    const [cookie] = setCookie.split(";");
    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex === -1) continue;

    const name = cookie.slice(0, separatorIndex).trim();
    const value = cookie.slice(separatorIndex + 1).trim();
    if (!name) continue;

    if (value === "") {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
}

async function requestJson<T>(
  path: string,
  options: RequestInit & { expectedStatus?: number } = {}
): Promise<T> {
  const { expectedStatus = 200, headers, ...fetchOptions } = options;
  const cookie = cookieHeader(cookieJar);
  const response = await fetch(new URL(path, API_URL), {
    ...fetchOptions,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
  });

  storeSetCookies(cookieJar, response.headers);

  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;
  if (response.status !== expectedStatus) {
    throw new Error(`${fetchOptions.method ?? "GET"} ${path} returned ${response.status}: ${text}`);
  }

  return body as T;
}

async function requestStatus(path: string, options: RequestInit = {}): Promise<number> {
  const cookie = cookieHeader(cookieJar);
  const response = await fetch(new URL(path, API_URL), {
    ...options,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...options.headers,
    },
  });
  storeSetCookies(cookieJar, response.headers);
  await response.arrayBuffer();
  return response.status;
}

async function me(accessToken: string): Promise<MeResponse> {
  return requestJson<MeResponse>("/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

console.log(`Skill Hub API: ${API_URL}`);
console.log(`Wallet: ${walletAddress}`);
console.log(`Chain ID: ${chainId}`);

const unauthenticatedMeStatus = await requestStatus("/me");
console.log(`\nGET /me without token -> ${unauthenticatedMeStatus}`);

if (unauthenticatedMeStatus !== 401) {
  throw new Error(`Expected unauthenticated /me to return 401, got ${unauthenticatedMeStatus}`);
}

const challenge = await requestJson<AuthChallenge>("/auth/wallet/challenge", {
  method: "POST",
  expectedStatus: 201,
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    wallet_address: walletAddress,
    chain_id: chainId,
  }),
});

console.log("\nChallenge:");
console.log(JSON.stringify(challenge, null, 2));

const message = buildSiweMessage(challenge);
const signature = await wallet.signMessage(message);

const login = await requestJson<TokenResponse>("/auth/wallet/login", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    challenge_id: challenge.challenge_id,
    message,
    signature,
  }),
});

console.log("\nLogin:");
console.log(JSON.stringify({
  expires_in: login.expires_in,
  access_token_prefix: login.access_token.slice(0, 24),
  has_refresh_cookie: cookieJar.has("refresh_token"),
}, null, 2));

const currentUser = await me(login.access_token);
console.log("\n/me with access token:");
console.log(JSON.stringify(currentUser, null, 2));

const refreshed = await requestJson<TokenResponse>("/auth/refresh", {
  method: "POST",
});

console.log("\nRefresh:");
console.log(JSON.stringify({
  expires_in: refreshed.expires_in,
  access_token_prefix: refreshed.access_token.slice(0, 24),
  has_refresh_cookie: cookieJar.has("refresh_token"),
}, null, 2));

const refreshedUser = await me(refreshed.access_token);
console.log("\n/me with refreshed access token:");
console.log(JSON.stringify(refreshedUser, null, 2));

await requestJson<{ ok: boolean }>("/auth/logout", {
  method: "POST",
});
console.log("\nLogout: ok");

const refreshAfterLogoutStatus = await requestStatus("/auth/refresh", {
  method: "POST",
});
console.log(`POST /auth/refresh after logout -> ${refreshAfterLogoutStatus}`);

if (refreshAfterLogoutStatus !== 401) {
  throw new Error(`Expected refresh after logout to return 401, got ${refreshAfterLogoutStatus}`);
}
