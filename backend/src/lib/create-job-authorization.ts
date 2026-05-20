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

const START_JOB_TYPES: Record<string, TypedDataField[]> = {
  StartJobAuthorization: [
    { name: "jobId", type: "uint256" },
    { name: "providerId", type: "uint256" },
    { name: "serviceId", type: "uint256" },
    { name: "inputCommitment", type: "bytes32" },
    { name: "expiresAt", type: "uint256" },
  ],
};

const JOB_ACCEPTANCE_TYPES: Record<string, TypedDataField[]> = {
  JobAcceptance: [
    { name: "jobId", type: "uint256" },
    { name: "providerId", type: "uint256" },
    { name: "serviceId", type: "uint256" },
    { name: "inputCommitment", type: "bytes32" },
    { name: "outputCommitment", type: "bytes32" },
    { name: "expiresAt", type: "uint256" },
  ],
};

const DELIVERY_ATTESTATION_TYPES: Record<string, TypedDataField[]> = {
  DeliveryAttestation: [
    { name: "jobId", type: "uint256" },
    { name: "providerId", type: "uint256" },
    { name: "serviceId", type: "uint256" },
    { name: "inputCommitment", type: "bytes32" },
    { name: "outputCommitment", type: "bytes32" },
    { name: "deliveredAt", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
  ],
};

const NO_DELIVERY_ATTESTATION_TYPES: Record<string, TypedDataField[]> = {
  NoDeliveryAttestation: [
    { name: "jobId", type: "uint256" },
    { name: "providerId", type: "uint256" },
    { name: "serviceId", type: "uint256" },
    { name: "inputCommitment", type: "bytes32" },
    { name: "checkedAt", type: "uint256" },
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
  inputJson?: unknown;
  expiresAt?: number;
  expiresInSeconds?: number;
};

type JobAuthorizationBaseParams = {
  jobId: string;
  providerId: string;
  serviceId: string;
  inputCommitment: string;
  expiresAt?: number;
  expiresInSeconds?: number;
};

type JobOutputParams = JobAuthorizationBaseParams & {
  outputCommitment: string;
};

type DeliveryAttestationParams = JobOutputParams & {
  deliveredAt: number;
};

type NoDeliveryAttestationParams = JobAuthorizationBaseParams & {
  checkedAt: number;
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

function positiveUnixSeconds(value: number | undefined, fieldName: string): number {
  if (value == null) {
    throw new CreateJobAuthorizationError(`${fieldName}_is_required`);
  }
  return positiveSafeInteger(value, fieldName);
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
  inputJson?: unknown;
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

  if (params.inputJson !== undefined) {
    return keccak256(toUtf8Bytes(JSON.stringify(params.inputJson)));
  }

  return keccak256(toUtf8Bytes(params.requestId));
}

function normalizeBytes32(value: string, fieldName: string): string {
  if (!isBytes32(value)) {
    throw new CreateJobAuthorizationError(`${fieldName}_must_be_bytes32`);
  }
  return value;
}

export function normalizeOutputCommitment(params: {
  outputCommitment?: string;
  outputHash?: string;
  outputJson?: unknown;
}): string {
  if (params.outputCommitment) {
    return normalizeBytes32(params.outputCommitment, "output_commitment");
  }

  if (params.outputHash) {
    return isBytes32(params.outputHash)
      ? params.outputHash
      : keccak256(toUtf8Bytes(params.outputHash));
  }

  if (params.outputJson !== undefined) {
    return keccak256(toUtf8Bytes(JSON.stringify(params.outputJson)));
  }

  throw new CreateJobAuthorizationError("output_commitment_is_required");
}

function authExpiresAt(expiresAt?: number, expiresInSeconds?: number): number {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const normalizedExpiresAt = positiveSafeInteger(
    expiresAt ??
      nowSeconds +
        (expiresInSeconds ?? optionalNumberEnv("JOB_AUTH_EXPIRES_IN_SECONDS", 3600)),
    "authorization_expires_at"
  );
  if (normalizedExpiresAt <= nowSeconds) {
    throw new CreateJobAuthorizationError("authorization_expires_at_must_be_future");
  }
  return normalizedExpiresAt;
}

function signingDomain() {
  const chainId = process.env.ESCROW_CHAIN_ID?.trim()
    ? optionalNumberEnv("ESCROW_CHAIN_ID", 5042002)
    : optionalNumberEnv("CHAIN_ID", 5042002);
  const verifyingContract = normalizeAddress(requiredEnv("ESCROW_CONTRACT_ADDRESS"), "ESCROW_CONTRACT_ADDRESS");

  return {
    name: "AgentHubEscrow",
    version: "1",
    chainId,
    verifyingContract,
  };
}

function deliveryAttesterWallet(): Wallet {
  return new Wallet(requiredEnv("DELIVERY_ATTESTER_PRIVATE_KEY"));
}

function jsonTypedData(
  primaryType: string,
  types: Record<string, TypedDataField[]>,
  value: Record<string, string | number>
) {
  return {
    domain: signingDomain(),
    primaryType,
    types,
    value,
  };
}

export async function signCreateJobAuthorization(params: CreateJobAuthorizationParams) {
  const wallet = deliveryAttesterWallet();

  const requestId = normalizeRequestId(params.requestId);
  const inputCommitment = normalizeInputCommitment({
    inputCommitment: params.inputCommitment,
    inputHash: params.inputHash,
    inputJson: params.inputJson,
    requestId,
  });
  const queueTimeoutSeconds = minSafeInteger(
    params.queueTimeoutSeconds ?? optionalNumberEnv("CREATE_JOB_QUEUE_TIMEOUT_SECONDS", 3600),
    60,
    "queue_timeout_seconds"
  );
  const expiresAt = authExpiresAt(
    params.expiresAt,
    params.expiresInSeconds ?? optionalNumberEnv("CREATE_JOB_AUTH_EXPIRES_IN_SECONDS", 3600)
  );

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

  const domain = signingDomain();

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

export function buildStartJobAuthorization(params: JobAuthorizationBaseParams) {
  const expiresAt = authExpiresAt(params.expiresAt, params.expiresInSeconds);
  const value = {
    jobId: uint256(params.jobId, "job_id").toString(),
    providerId: uint256(params.providerId, "provider_id").toString(),
    serviceId: uint256(params.serviceId, "service_id").toString(),
    inputCommitment: normalizeBytes32(params.inputCommitment, "input_commitment"),
    expiresAt: expiresAt.toString(),
  };

  return {
    typed_data: jsonTypedData("StartJobAuthorization", START_JOB_TYPES, value),
    start_job_args: {
      job_id: value.jobId,
      expires_at: expiresAt,
    },
  };
}

export function buildJobAcceptance(params: JobOutputParams) {
  const expiresAt = authExpiresAt(params.expiresAt, params.expiresInSeconds);
  const value = {
    jobId: uint256(params.jobId, "job_id").toString(),
    providerId: uint256(params.providerId, "provider_id").toString(),
    serviceId: uint256(params.serviceId, "service_id").toString(),
    inputCommitment: normalizeBytes32(params.inputCommitment, "input_commitment"),
    outputCommitment: normalizeBytes32(params.outputCommitment, "output_commitment"),
    expiresAt: expiresAt.toString(),
  };

  return {
    typed_data: jsonTypedData("JobAcceptance", JOB_ACCEPTANCE_TYPES, value),
    settle_with_user_signature_args: {
      job_id: value.jobId,
      output_commitment: value.outputCommitment,
      expires_at: expiresAt,
    },
  };
}

export async function signDeliveryAttestation(params: DeliveryAttestationParams) {
  const expiresAt = authExpiresAt(params.expiresAt, params.expiresInSeconds);
  const deliveredAt = positiveUnixSeconds(params.deliveredAt, "delivered_at");
  const value = {
    jobId: uint256(params.jobId, "job_id").toString(),
    providerId: uint256(params.providerId, "provider_id").toString(),
    serviceId: uint256(params.serviceId, "service_id").toString(),
    inputCommitment: normalizeBytes32(params.inputCommitment, "input_commitment"),
    outputCommitment: normalizeBytes32(params.outputCommitment, "output_commitment"),
    deliveredAt: deliveredAt.toString(),
    expiresAt: expiresAt.toString(),
  };

  const signature = await deliveryAttesterWallet().signTypedData(
    signingDomain(),
    DELIVERY_ATTESTATION_TYPES,
    value
  );

  return {
    delivered_at: deliveredAt,
    expires_at: expiresAt,
    delivery_attester_signature: signature,
    settle_after_review_timeout_args: {
      job_id: value.jobId,
      output_commitment: value.outputCommitment,
      delivered_at: deliveredAt,
      expires_at: expiresAt,
      delivery_attester_signature: signature,
    },
  };
}

export async function signNoDeliveryAttestation(params: NoDeliveryAttestationParams) {
  const expiresAt = authExpiresAt(params.expiresAt, params.expiresInSeconds);
  const checkedAt = positiveUnixSeconds(params.checkedAt, "checked_at");
  const value = {
    jobId: uint256(params.jobId, "job_id").toString(),
    providerId: uint256(params.providerId, "provider_id").toString(),
    serviceId: uint256(params.serviceId, "service_id").toString(),
    inputCommitment: normalizeBytes32(params.inputCommitment, "input_commitment"),
    checkedAt: checkedAt.toString(),
    expiresAt: expiresAt.toString(),
  };

  const signature = await deliveryAttesterWallet().signTypedData(
    signingDomain(),
    NO_DELIVERY_ATTESTATION_TYPES,
    value
  );

  return {
    checked_at: checkedAt,
    expires_at: expiresAt,
    no_delivery_attester_signature: signature,
    refund_with_no_delivery_attestation_args: {
      job_id: value.jobId,
      checked_at: checkedAt,
      expires_at: expiresAt,
      no_delivery_attester_signature: signature,
    },
  };
}
