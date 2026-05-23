import { getAddress } from "ethers";
import { signerWallet } from "./transactions.ts";

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

type LoginWithWalletOptions = {
  baseUrl: string;
  chainId?: number;
};

export function userAuthChainId(): number {
  const chainId = Number(process.env.AUTH_CHAIN_ID ?? process.env.CHAIN_ID ?? "5042002");
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("AUTH_CHAIN_ID must be a positive integer when set");
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

async function postJson<T>(baseUrl: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Skill Hub API error ${response.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}

export async function loginWithWallet(options: LoginWithWalletOptions): Promise<TokenResponse> {
  const wallet = signerWallet();
  const walletAddress = getAddress(wallet.address);
  const chainId = options.chainId ?? userAuthChainId();

  const challenge = await postJson<AuthChallenge>(options.baseUrl, "/auth/wallet/challenge", {
    wallet_address: walletAddress,
    chain_id: chainId,
  });
  const message = buildSiweMessage(challenge);
  const signature = await wallet.signMessage(message);

  return postJson<TokenResponse>(options.baseUrl, "/auth/wallet/login", {
    challenge_id: challenge.challenge_id,
    message,
    signature,
  });
}
