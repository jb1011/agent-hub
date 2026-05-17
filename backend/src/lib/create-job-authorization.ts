import {
  Wallet,
  getAddress,
  hexlify,
  isAddress,
  isHexString,
  keccak256,
  parseUnits,
  randomBytes,
  toUtf8Bytes,
  type TypedDataField,
} from "ethers";
import { isUint256String } from "./uint256.js";

const CREATE_JOB_TYPES: Record<string, TypedDataField[]> = {
  CreateJobAuthorization: [
    { name: "user", type: "address" },
    { name: "providerId", type: "uint256" },
    { name: "serviceId", type: "uint256" },
    { name: "price", type: "uint256" },
    { name: "workTimeout", type: "uint64" },
    { name: "queueTimeoutSeconds", type: "uint64" },
    { name: "requestId", type: "bytes32" },
    { name: "inputCommitment", type: "bytes32" },
    { name: "expiresAt", type: "uint256" },
  ],
};

type CreateJobAuthorizationParams = {
  userWallet: string;
  providerId: string;
  serviceId: string;
  priceUsdc: string;
  workTimeoutSeconds: number;
  queueTimeoutSeconds?: number;
  requestId?: string;
  inputCommitment?: string;
  inputHash?: string;
  inputUri?: string;
  expiresAt?: number;
  expiresInSeconds?: number;
};

export class CreateJobAuthorizationError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

export function isBytes32(value: string): boolean {
  return isHexString(value, 32);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new CreateJobAuthorizationError(`missing_env_${name}`, 500);
  }
  return value;
}

function optionalNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CreateJobAuthorizationError(`${name}_must_be_positive_integer`, 500);
  }
  return value;
}

function uint256(value: string, fieldName: string): bigint {
  if (!isUint256String(value)) {
    throw new CreateJobAuthorizationError(`${fieldName}_must_be_uint256_decimal_string`);
  }
  return BigInt(value);
}

function positiveSafeInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CreateJobAuthorizationError(`${fieldName}_must_be_positive_integer`);
  }
  return value;
}

function minSafeInteger(value: number, minimum: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new CreateJobAuthorizationError(`${fieldName}_must_be_at_least_${minimum}`);
  }
  return value;
}

function normalizeAddress(value: string, fieldName: string): string {
  if (!isAddress(value)) {
    throw new CreateJobAuthorizationError(`${fieldName}_must_be_evm_address`);
  }
  return getAddress(value);
}

function normalizeRequestId(requestId?: string): string {
  if (!requestId) return hexlify(randomBytes(32));
  if (!isBytes32(requestId)) {
    throw new CreateJobAuthorizationError("request_id_must_be_bytes32");
  }
  return requestId;
}

function normalizeInputCommitment(params: {
  inputCommitment?: string;
  inputHash?: string;
  inputUri?: string;
  requestId: string;
}): string {
  if (params.inputCommitment) {
    if (!isBytes32(params.inputCommitment)) {
      throw new CreateJobAuthorizationError("input_commitment_must_be_bytes32");
    }
    return params.inputCommitment;
  }

  if (params.inputHash) {
    return isBytes32(params.inputHash)
      ? params.inputHash
      : keccak256(toUtf8Bytes(params.inputHash));
  }

  if (params.inputUri) {
    return keccak256(toUtf8Bytes(params.inputUri));
  }

  return keccak256(toUtf8Bytes(params.requestId));
}

export async function signCreateJobAuthorization(params: CreateJobAuthorizationParams) {
  const chainId = process.env.ESCROW_CHAIN_ID?.trim()
    ? optionalNumberEnv("ESCROW_CHAIN_ID", 5042002)
    : optionalNumberEnv("CHAIN_ID", 5042002);
  const verifyingContract = normalizeAddress(requiredEnv("ESCROW_CONTRACT_ADDRESS"), "ESCROW_CONTRACT_ADDRESS");
  const wallet = new Wallet(requiredEnv("DELIVERY_ATTESTER_PRIVATE_KEY"));

  const requestId = normalizeRequestId(params.requestId);
  const inputCommitment = normalizeInputCommitment({
    inputCommitment: params.inputCommitment,
    inputHash: params.inputHash,
    inputUri: params.inputUri,
    requestId,
  });
  const queueTimeoutSeconds = minSafeInteger(
    params.queueTimeoutSeconds ?? optionalNumberEnv("CREATE_JOB_QUEUE_TIMEOUT_SECONDS", 3600),
    60,
    "queue_timeout_seconds"
  );
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = positiveSafeInteger(
    params.expiresAt ??
      nowSeconds +
        (params.expiresInSeconds ?? optionalNumberEnv("CREATE_JOB_AUTH_EXPIRES_IN_SECONDS", 3600)),
    "authorization_expires_at"
  );
  if (expiresAt <= nowSeconds) {
    throw new CreateJobAuthorizationError("authorization_expires_at_must_be_future");
  }

  const value = {
    user: normalizeAddress(params.userWallet, "user_wallet"),
    providerId: uint256(params.providerId, "provider_id"),
    serviceId: uint256(params.serviceId, "service_id"),
    price: parseUnits(params.priceUsdc, 6),
    workTimeout: BigInt(positiveSafeInteger(params.workTimeoutSeconds, "work_timeout_seconds")),
    queueTimeoutSeconds: BigInt(queueTimeoutSeconds),
    requestId,
    inputCommitment,
    expiresAt: BigInt(expiresAt),
  };

  const domain = {
    name: "AgentHubEscrow",
    version: "1",
    chainId,
    verifyingContract,
  };

  const signature = await wallet.signTypedData(domain, CREATE_JOB_TYPES, value);

  return {
    user_wallet: value.user,
    service_id: value.serviceId.toString(),
    request_id: requestId,
    input_commitment: inputCommitment,
    queue_timeout_seconds: queueTimeoutSeconds,
    expires_at: expiresAt,
    delivery_attester_signature: signature,
  };
}
