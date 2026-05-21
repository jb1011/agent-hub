import { Wallet, getAddress, isAddress, parseUnits, type TypedDataField } from "ethers";
import { isUint256String } from "./uint256.js";

const REGISTER_PROVIDER_TYPES: Record<string, TypedDataField[]> = {
  RegisterProviderAuthorization: [
    { name: "owner", type: "address" },
    { name: "signer", type: "address" },
    { name: "payoutWallet", type: "address" },
    { name: "price", type: "uint256" },
    { name: "workTimeout", type: "uint64" },
    { name: "metadataCommitment", type: "bytes32" },
    { name: "expiresAt", type: "uint256" },
  ],
};

export class RegisterProviderAuthorizationError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

type RegisterProviderAuthorizationParams = {
  ownerWallet: string;
  signerWallet: string;
  payoutWallet: string;
  priceUsdc: string;
  workTimeoutSeconds: number;
  metadataCommitment: string;
  expiresAt?: number;
  expiresInSeconds?: number;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new RegisterProviderAuthorizationError(`missing_env_${name}`, 500);
  }
  return value;
}

function firstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }

  return undefined;
}

function optionalNumberEnv(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new RegisterProviderAuthorizationError(`${name}_must_be_positive_integer`, 500);
  }
  return parsed;
}

function normalizeAddress(value: string, fieldName: string): string {
  if (!isAddress(value)) {
    throw new RegisterProviderAuthorizationError(`${fieldName}_must_be_evm_address`);
  }
  return getAddress(value);
}

function positiveSafeInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RegisterProviderAuthorizationError(`${fieldName}_must_be_positive_integer`);
  }
  return value;
}

function authExpiresAt(expiresAt?: number, expiresInSeconds?: number): number {
  const now = Math.floor(Date.now() / 1000);
  const resolved =
    expiresAt ??
    now + (expiresInSeconds ?? optionalNumberEnv("REGISTER_PROVIDER_AUTH_EXPIRES_IN_SECONDS", 3600));
  if (!Number.isSafeInteger(resolved) || resolved <= now) {
    throw new RegisterProviderAuthorizationError("authorization_expires_at_must_be_future");
  }
  return resolved;
}

function signingDomain() {
  const rawChainId = firstEnv(["AGENT_HUB_CHAIN_ID", "ESCROW_CHAIN_ID", "CHAIN_ID"]);
  if (!rawChainId) {
    throw new RegisterProviderAuthorizationError("missing_env_AGENT_HUB_CHAIN_ID", 500);
  }

  const chainId = Number(rawChainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new RegisterProviderAuthorizationError("AGENT_HUB_CHAIN_ID_must_be_positive_integer", 500);
  }

  const registryAddress = firstEnv(["AGENT_HUB_REGISTRY_ADDRESS", "REGISTRY_CONTRACT_ADDRESS"]);
  if (!registryAddress) {
    throw new RegisterProviderAuthorizationError("missing_env_AGENT_HUB_REGISTRY_ADDRESS", 500);
  }

  return {
    name: "AgentHubRegistry",
    version: "1",
    chainId,
    verifyingContract: getAddress(registryAddress),
  };
}

function deliveryAttesterWallet(): Wallet {
  return new Wallet(requiredEnv("DELIVERY_ATTESTER_PRIVATE_KEY"));
}

export async function signRegisterProviderAuthorization(params: RegisterProviderAuthorizationParams) {
  const wallet = deliveryAttesterWallet();
  const expiresAt = authExpiresAt(params.expiresAt, params.expiresInSeconds);

  const value = {
    owner: normalizeAddress(params.ownerWallet, "owner_wallet"),
    signer: normalizeAddress(params.signerWallet, "signer_wallet"),
    payoutWallet: normalizeAddress(params.payoutWallet, "payout_wallet"),
    price: parseUnits(params.priceUsdc, 6),
    workTimeout: BigInt(positiveSafeInteger(params.workTimeoutSeconds, "work_timeout_seconds")),
    metadataCommitment: params.metadataCommitment,
    expiresAt: BigInt(expiresAt),
  };

  const signature = await wallet.signTypedData(signingDomain(), REGISTER_PROVIDER_TYPES, value);

  return {
    owner_wallet: value.owner,
    signer_wallet: value.signer,
    payout_wallet: value.payoutWallet,
    price: value.price.toString(),
    work_timeout: Number(value.workTimeout),
    metadata_commitment: value.metadataCommitment,
    expires_at: expiresAt,
    registration_attester_signature: signature,
  };
}

export function assertRegistryProviderId(registryProviderId: string) {
  if (!isUint256String(registryProviderId)) {
    throw new RegisterProviderAuthorizationError("registry_provider_id_must_be_uint256_decimal_string");
  }
}
