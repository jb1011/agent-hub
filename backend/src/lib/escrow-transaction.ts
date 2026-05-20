import { Interface, getAddress } from "ethers";
import { CreateJobAuthorizationError } from "./create-job-authorization.js";
import type { PreparedContractTransaction } from "./registry-call.js";

const AGENT_HUB_ESCROW_INTERFACE = new Interface([
  "function createJob(uint256 providerId, bytes32 requestId, bytes32 inputCommitment, uint64 queueTimeoutSeconds, uint256 expiresAt, bytes deliveryAttesterSignature)",
  "function refundAfterQueueTimeout(uint256 jobId)",
  "function refundAfterFinalTimeout(uint256 jobId)",
]);

type CreateJobTransactionParams = {
  providerId: string;
  requestId: string;
  inputCommitment: string;
  queueTimeoutSeconds: number;
  expiresAt: number;
  deliveryAttesterSignature: string;
  userWallet: string;
};

function firstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }

  return undefined;
}

function escrowContractAddress(): string {
  const value = firstEnv(["ESCROW_CONTRACT_ADDRESS", "AGENT_HUB_ESCROW_ADDRESS"]);
  if (!value) throw new CreateJobAuthorizationError("missing_env_ESCROW_CONTRACT_ADDRESS", 500);
  return getAddress(value);
}

function escrowChainId(): number | undefined {
  const value = firstEnv(["ESCROW_CHAIN_ID", "AGENT_HUB_CHAIN_ID"]);
  if (!value) return undefined;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new CreateJobAuthorizationError("ESCROW_CHAIN_ID_must_be_positive_integer", 500);
  }

  return parsed;
}

function preparedEscrowTransaction(
  functionName: "createJob" | "refundAfterQueueTimeout" | "refundAfterFinalTimeout",
  args: readonly unknown[],
  from?: string
): PreparedContractTransaction {
  const chainId = escrowChainId();

  return {
    to: escrowContractAddress(),
    data: AGENT_HUB_ESCROW_INTERFACE.encodeFunctionData(functionName, args),
    value: "0",
    ...(from ? { from: getAddress(from) } : {}),
    ...(chainId ? { chain_id: chainId } : {}),
  };
}

export function buildCreateJobTransaction(params: CreateJobTransactionParams): PreparedContractTransaction {
  return preparedEscrowTransaction(
    "createJob",
    [
      params.providerId,
      params.requestId,
      params.inputCommitment,
      params.queueTimeoutSeconds,
      params.expiresAt,
      params.deliveryAttesterSignature,
    ],
    params.userWallet
  );
}

export function buildRefundAfterQueueTimeoutTransaction(jobId: string): PreparedContractTransaction {
  return preparedEscrowTransaction("refundAfterQueueTimeout", [jobId]);
}

export function buildRefundAfterFinalTimeoutTransaction(jobId: string): PreparedContractTransaction {
  return preparedEscrowTransaction("refundAfterFinalTimeout", [jobId]);
}
