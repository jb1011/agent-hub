import {
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  WebSocketProvider,
  getAddress,
  isHexString,
  type ContractTransactionReceipt,
} from "ethers";
import { CreateJobAuthorizationError } from "./create-job-authorization.js";

const ESCROW_ABI = [
  "function getJob(uint256 jobId) view returns (tuple(address user,address providerPayoutWallet,address treasury,address deliveryAttester,uint256 providerId,uint256 price,uint256 protocolFee,uint64 queueDeadline,uint64 startedAt,uint64 workTimeout,uint64 workDeadline,uint64 reviewTimeout,uint64 finalRefundDeadline,uint64 deliveredAt,uint64 settledAt,uint64 refundedAt,uint8 status,bytes32 requestId,bytes32 inputCommitment,bytes32 outputCommitment))",
  "function startJob(uint256 jobId, uint256 expiresAt, bytes providerSignature)",
  "function settleWithUserSignature(uint256 jobId, bytes32 outputCommitment, uint256 expiresAt, bytes userSignature)",
  "function settleAfterReviewTimeout(uint256 jobId, bytes32 outputCommitment, uint256 deliveredAt, uint256 expiresAt, bytes deliveryAttesterSignature)",
  "function refundWithNoDeliveryAttestation(uint256 jobId, uint256 checkedAt, uint256 expiresAt, bytes noDeliveryAttesterSignature)",
  "event JobStarted(uint256 indexed jobId, uint256 indexed providerId, uint64 startedAt, uint64 workDeadline, uint64 finalRefundDeadline)",
  "event JobSettledWithUserSignature(uint256 indexed jobId, bytes32 outputCommitment, address providerPayoutWallet, uint256 providerAmount, uint256 protocolFee)",
  "event JobSettledAfterReviewTimeout(uint256 indexed jobId, bytes32 outputCommitment, uint64 deliveredAt, address providerPayoutWallet, uint256 providerAmount, uint256 protocolFee)",
  "event JobRefundedWithNoDeliveryAttestation(uint256 indexed jobId, uint64 checkedAt, uint256 amount)",
  "error InvalidJob()",
  "error JobNotQueued()",
  "error JobNotRunning()",
  "error InvalidCommitment()",
  "error QueueDeadlineExceeded()",
  "error WorkDeadlineExceeded()",
  "error AuthorizationExpired()",
  "error ProviderNotActive()",
  "error InvalidSignature()",
  "error DeliveredBeforeStart()",
  "error FutureDeliveredAt()",
  "error ReviewTimeoutNotElapsed()",
  "error CheckedBeforeWorkDeadline()",
  "error FutureCheckedAt()",
] as const;

const JOB_STATUSES = ["NONE", "FUNDED", "RUNNING", "SETTLED", "REFUNDED"] as const;

type EthersError = {
  reason?: string;
  data?: string;
  shortMessage?: string;
  error?: EthersError;
};

type EscrowJob = {
  providerId: bigint;
  queueDeadline: bigint;
  workTimeout: bigint;
  workDeadline: bigint;
  status: bigint | number;
  inputCommitment: string;
};

export type RelayedStartJob = {
  transaction_hash: string;
  relayer_address: string;
  block_number: number | null;
  gas_used: string | null;
  started_at: number | null;
  work_deadline: number | null;
  final_refund_deadline: number | null;
};

export type RelayedSettleWithUserSignature = {
  transaction_hash: string;
  relayer_address: string;
  block_number: number | null;
  gas_used: string | null;
  settled_at: number | null;
  provider_payout_wallet: string | null;
  provider_amount: string | null;
  protocol_fee: string | null;
};

export type RelayedSettleAfterReviewTimeout = RelayedSettleWithUserSignature & {
  delivered_at: number | null;
};

export type RelayedRefundWithNoDeliveryAttestation = {
  transaction_hash: string;
  relayer_address: string;
  block_number: number | null;
  gas_used: string | null;
  refunded_at: number | null;
  checked_at: number | null;
  amount: string | null;
};

function firstEnv(names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function requiredRelayerEnv(names: string[], label: string): string {
  const value = firstEnv(names);
  if (!value) throw new CreateJobAuthorizationError(`missing_env_${label}`, 500);
  return value;
}

function relayerPrivateKey(): string {
  const privateKey = requiredRelayerEnv(
    [
      "RELAYER_PRIVATE_KEY",
      "WALLET_RELAYER_PRIVATE_KEY",
      "RELAYER",
      "relayer",
      "WALLET_RELAYER",
      "wallet_relayer",
    ],
    "RELAYER_PRIVATE_KEY"
  );
  const normalized = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  if (!isHexString(normalized, 32)) {
    throw new CreateJobAuthorizationError("RELAYER_PRIVATE_KEY_must_be_32_byte_hex", 500);
  }
  return normalized;
}

function escrowContractAddress(): string {
  return getAddress(
    requiredRelayerEnv(["ESCROW_CONTRACT_ADDRESS", "AGENT_HUB_ESCROW_ADDRESS"], "ESCROW_CONTRACT_ADDRESS")
  );
}

function rpcUrl(): string {
  return requiredRelayerEnv(["ARC_RPC_URL", "RPC_URL", "ARC_RPC_WS_URL"], "ARC_RPC_URL");
}

const webSocketProviders = new Map<string, WebSocketProvider>();

function providerFor(url: string): JsonRpcProvider | WebSocketProvider {
  const isWebSocket = url.startsWith("ws:") || url.startsWith("wss:");
  if (!isWebSocket) return new JsonRpcProvider(url);

  let provider = webSocketProviders.get(url);
  if (!provider) {
    provider = new WebSocketProvider(url);
    webSocketProviders.set(url, provider);
  }
  return provider;
}

async function destroyProviderQuietly(provider: JsonRpcProvider | WebSocketProvider): Promise<void> {
  if (provider instanceof WebSocketProvider) return;

  try {
    await provider.destroy();
  } catch {
    // ethers may reject in-flight polling requests while closing an HTTP provider.
  }
}

function findErrorData(error: EthersError): string | undefined {
  if (typeof error.data === "string" && isHexString(error.data)) return error.data;
  if (error.error) return findErrorData(error.error);
  return undefined;
}

function explainContractError(
  error: EthersError,
  contractInterface: Interface,
  operation: string
): CreateJobAuthorizationError {
  const data = findErrorData(error);
  if (!data || data === "0x") {
    const message = error.shortMessage ?? error.reason ?? "transaction_simulation_failed";
    return new CreateJobAuthorizationError(message, 409);
  }

  try {
    const parsedError = contractInterface.parseError(data);
    if (parsedError) {
      const args = parsedError.args.length > 0
        ? `_${parsedError.args.map((arg) => arg.toString()).join("_")}`
        : "";
      return new CreateJobAuthorizationError(`${operation}_reverted_${parsedError.name}${args}`, 409);
    }
  } catch {
    // Fall through to a generic error with no raw revert data in the public API.
  }

  return new CreateJobAuthorizationError("transaction_simulation_failed", 409);
}

function receiptJobStarted(receipt: ContractTransactionReceipt | null, contract: Contract) {
  if (!receipt) return null;

  for (const log of receipt.logs) {
    let parsed;
    try {
      parsed = contract.interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name !== "JobStarted") continue;
    return {
      started_at: Number(parsed.args.startedAt),
      work_deadline: Number(parsed.args.workDeadline),
      final_refund_deadline: Number(parsed.args.finalRefundDeadline),
    };
  }

  return null;
}

function receiptJobSettledWithUserSignature(receipt: ContractTransactionReceipt | null, contract: Contract) {
  if (!receipt) return null;

  for (const log of receipt.logs) {
    let parsed;
    try {
      parsed = contract.interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name !== "JobSettledWithUserSignature") continue;
    return {
      provider_payout_wallet: parsed.args.providerPayoutWallet as string,
      provider_amount: parsed.args.providerAmount.toString(),
      protocol_fee: parsed.args.protocolFee.toString(),
    };
  }

  return null;
}

function receiptJobSettledAfterReviewTimeout(receipt: ContractTransactionReceipt | null, contract: Contract) {
  if (!receipt) return null;

  for (const log of receipt.logs) {
    let parsed;
    try {
      parsed = contract.interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name !== "JobSettledAfterReviewTimeout") continue;
    return {
      delivered_at: Number(parsed.args.deliveredAt),
      provider_payout_wallet: parsed.args.providerPayoutWallet as string,
      provider_amount: parsed.args.providerAmount.toString(),
      protocol_fee: parsed.args.protocolFee.toString(),
    };
  }

  return null;
}

function receiptJobRefundedWithNoDeliveryAttestation(receipt: ContractTransactionReceipt | null, contract: Contract) {
  if (!receipt) return null;

  for (const log of receipt.logs) {
    let parsed;
    try {
      parsed = contract.interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name !== "JobRefundedWithNoDeliveryAttestation") continue;
    return {
      checked_at: Number(parsed.args.checkedAt),
      amount: parsed.args.amount.toString(),
    };
  }

  return null;
}

export async function relayStartJob(params: {
  jobId: string;
  expiresAt: number;
  providerSignature: string;
}): Promise<RelayedStartJob> {
  const provider = providerFor(rpcUrl());

  try {
    const wallet = new Wallet(relayerPrivateKey(), provider);
    const relayerAddress = await wallet.getAddress();
    const contract = new Contract(escrowContractAddress(), ESCROW_ABI, wallet);

    const jobId = BigInt(params.jobId);
    const expiresAt = BigInt(params.expiresAt);
    const latestBlock = await provider.getBlock("latest");
    if (!latestBlock) throw new CreateJobAuthorizationError("latest_block_unavailable", 500);

    const job = await contract.getJob(jobId) as EscrowJob;
    const status = Number(job.status);
    const statusName = JOB_STATUSES[status] ?? `UNKNOWN_${status}`;

    if (status !== 1) {
      throw new CreateJobAuthorizationError(`onchain_job_not_funded_status_${statusName}`, 409);
    }
    if (BigInt(latestBlock.timestamp) > job.queueDeadline) {
      throw new CreateJobAuthorizationError("onchain_queue_deadline_expired", 409);
    }
    if (expiresAt <= BigInt(latestBlock.timestamp)) {
      throw new CreateJobAuthorizationError("authorization_expires_at_expired_onchain", 409);
    }

    let gasLimit: bigint;
    try {
      await contract.startJob.staticCall(jobId, expiresAt, params.providerSignature);
      const estimatedGas = await contract.startJob.estimateGas(jobId, expiresAt, params.providerSignature);
      gasLimit = estimatedGas * 120n / 100n;
    } catch (err) {
      throw explainContractError(err as EthersError, contract.interface, "start_job");
    }

    const tx = await contract.startJob(jobId, expiresAt, params.providerSignature, { gasLimit });
    const receipt = await tx.wait();
    const started = receiptJobStarted(receipt, contract);

    return {
      transaction_hash: tx.hash,
      relayer_address: relayerAddress,
      block_number: receipt?.blockNumber ?? null,
      gas_used: receipt?.gasUsed?.toString() ?? null,
      started_at: started?.started_at ?? null,
      work_deadline: started?.work_deadline ?? null,
      final_refund_deadline: started?.final_refund_deadline ?? null,
    };
  } finally {
    await destroyProviderQuietly(provider);
  }
}

export async function relayRefundWithNoDeliveryAttestation(params: {
  jobId: string;
  checkedAt: number;
  expiresAt: number;
  noDeliveryAttesterSignature: string;
}): Promise<RelayedRefundWithNoDeliveryAttestation> {
  const provider = providerFor(rpcUrl());

  try {
    const wallet = new Wallet(relayerPrivateKey(), provider);
    const contract = new Contract(escrowContractAddress(), ESCROW_ABI, wallet);

    const jobId = BigInt(params.jobId);
    const checkedAt = BigInt(params.checkedAt);
    const expiresAt = BigInt(params.expiresAt);
    const latestBlock = await provider.getBlock("latest");
    if (!latestBlock) throw new CreateJobAuthorizationError("latest_block_unavailable", 500);

    const job = await contract.getJob(jobId) as EscrowJob;
    const status = Number(job.status);
    const statusName = JOB_STATUSES[status] ?? `UNKNOWN_${status}`;

    if (status !== 2) {
      throw new CreateJobAuthorizationError(`onchain_job_not_running_status_${statusName}`, 409);
    }
    if (expiresAt <= BigInt(latestBlock.timestamp)) {
      throw new CreateJobAuthorizationError("authorization_expires_at_expired_onchain", 409);
    }

    let gasLimit: bigint;
    try {
      await contract.refundWithNoDeliveryAttestation.staticCall(
        jobId,
        checkedAt,
        expiresAt,
        params.noDeliveryAttesterSignature
      );
      const estimatedGas = await contract.refundWithNoDeliveryAttestation.estimateGas(
        jobId,
        checkedAt,
        expiresAt,
        params.noDeliveryAttesterSignature
      );
      gasLimit = estimatedGas * 120n / 100n;
    } catch (err) {
      throw explainContractError(err as EthersError, contract.interface, "refund_with_no_delivery_attestation");
    }

    const tx = await contract.refundWithNoDeliveryAttestation(
      jobId,
      checkedAt,
      expiresAt,
      params.noDeliveryAttesterSignature,
      { gasLimit }
    );
    const receipt = await tx.wait();
    const refunded = receiptJobRefundedWithNoDeliveryAttestation(receipt, contract);
    const receiptBlock = receipt ? await provider.getBlock(receipt.blockNumber) : null;

    return {
      transaction_hash: tx.hash,
      relayer_address: await wallet.getAddress(),
      block_number: receipt?.blockNumber ?? null,
      gas_used: receipt?.gasUsed?.toString() ?? null,
      refunded_at: receiptBlock?.timestamp ?? null,
      checked_at: refunded?.checked_at ?? null,
      amount: refunded?.amount ?? null,
    };
  } finally {
    await destroyProviderQuietly(provider);
  }
}

export async function relaySettleWithUserSignature(params: {
  jobId: string;
  outputCommitment: string;
  expiresAt: number;
  userSignature: string;
}): Promise<RelayedSettleWithUserSignature> {
  const provider = providerFor(rpcUrl());

  try {
    const wallet = new Wallet(relayerPrivateKey(), provider);
    const contract = new Contract(escrowContractAddress(), ESCROW_ABI, wallet);

    const jobId = BigInt(params.jobId);
    const expiresAt = BigInt(params.expiresAt);
    const latestBlock = await provider.getBlock("latest");
    if (!latestBlock) throw new CreateJobAuthorizationError("latest_block_unavailable", 500);

    const job = await contract.getJob(jobId) as EscrowJob;
    const status = Number(job.status);
    const statusName = JOB_STATUSES[status] ?? `UNKNOWN_${status}`;

    if (status !== 2) {
      throw new CreateJobAuthorizationError(`onchain_job_not_running_status_${statusName}`, 409);
    }
    if (params.outputCommitment === "0x0000000000000000000000000000000000000000000000000000000000000000") {
      throw new CreateJobAuthorizationError("output_commitment_must_be_non_zero", 400);
    }
    if (expiresAt <= BigInt(latestBlock.timestamp)) {
      throw new CreateJobAuthorizationError("authorization_expires_at_expired_onchain", 409);
    }

    let gasLimit: bigint;
    try {
      await contract.settleWithUserSignature.staticCall(
        jobId,
        params.outputCommitment,
        expiresAt,
        params.userSignature
      );
      const estimatedGas = await contract.settleWithUserSignature.estimateGas(
        jobId,
        params.outputCommitment,
        expiresAt,
        params.userSignature
      );
      gasLimit = estimatedGas * 120n / 100n;
    } catch (err) {
      throw explainContractError(err as EthersError, contract.interface, "settle_with_user_signature");
    }

    const tx = await contract.settleWithUserSignature(
      jobId,
      params.outputCommitment,
      expiresAt,
      params.userSignature,
      { gasLimit }
    );
    const receipt = await tx.wait();
    const settled = receiptJobSettledWithUserSignature(receipt, contract);
    const receiptBlock = receipt ? await provider.getBlock(receipt.blockNumber) : null;

    return {
      transaction_hash: tx.hash,
      relayer_address: await wallet.getAddress(),
      block_number: receipt?.blockNumber ?? null,
      gas_used: receipt?.gasUsed?.toString() ?? null,
      settled_at: receiptBlock?.timestamp ?? null,
      provider_payout_wallet: settled?.provider_payout_wallet ?? null,
      provider_amount: settled?.provider_amount ?? null,
      protocol_fee: settled?.protocol_fee ?? null,
    };
  } finally {
    await destroyProviderQuietly(provider);
  }
}

export async function relaySettleAfterReviewTimeout(params: {
  jobId: string;
  outputCommitment: string;
  deliveredAt: number;
  expiresAt: number;
  deliveryAttesterSignature: string;
}): Promise<RelayedSettleAfterReviewTimeout> {
  const provider = providerFor(rpcUrl());

  try {
    const wallet = new Wallet(relayerPrivateKey(), provider);
    const contract = new Contract(escrowContractAddress(), ESCROW_ABI, wallet);

    const jobId = BigInt(params.jobId);
    const deliveredAt = BigInt(params.deliveredAt);
    const expiresAt = BigInt(params.expiresAt);
    const latestBlock = await provider.getBlock("latest");
    if (!latestBlock) throw new CreateJobAuthorizationError("latest_block_unavailable", 500);

    const job = await contract.getJob(jobId) as EscrowJob;
    const status = Number(job.status);
    const statusName = JOB_STATUSES[status] ?? `UNKNOWN_${status}`;

    if (status !== 2) {
      throw new CreateJobAuthorizationError(`onchain_job_not_running_status_${statusName}`, 409);
    }
    if (params.outputCommitment === "0x0000000000000000000000000000000000000000000000000000000000000000") {
      throw new CreateJobAuthorizationError("output_commitment_must_be_non_zero", 400);
    }
    if (expiresAt <= BigInt(latestBlock.timestamp)) {
      throw new CreateJobAuthorizationError("authorization_expires_at_expired_onchain", 409);
    }

    let gasLimit: bigint;
    try {
      await contract.settleAfterReviewTimeout.staticCall(
        jobId,
        params.outputCommitment,
        deliveredAt,
        expiresAt,
        params.deliveryAttesterSignature
      );
      const estimatedGas = await contract.settleAfterReviewTimeout.estimateGas(
        jobId,
        params.outputCommitment,
        deliveredAt,
        expiresAt,
        params.deliveryAttesterSignature
      );
      gasLimit = estimatedGas * 120n / 100n;
    } catch (err) {
      throw explainContractError(err as EthersError, contract.interface, "settle_after_review_timeout");
    }

    const tx = await contract.settleAfterReviewTimeout(
      jobId,
      params.outputCommitment,
      deliveredAt,
      expiresAt,
      params.deliveryAttesterSignature,
      { gasLimit }
    );
    const receipt = await tx.wait();
    const settled = receiptJobSettledAfterReviewTimeout(receipt, contract);
    const receiptBlock = receipt ? await provider.getBlock(receipt.blockNumber) : null;

    return {
      transaction_hash: tx.hash,
      relayer_address: await wallet.getAddress(),
      block_number: receipt?.blockNumber ?? null,
      gas_used: receipt?.gasUsed?.toString() ?? null,
      settled_at: receiptBlock?.timestamp ?? null,
      delivered_at: settled?.delivered_at ?? null,
      provider_payout_wallet: settled?.provider_payout_wallet ?? null,
      provider_amount: settled?.provider_amount ?? null,
      protocol_fee: settled?.protocol_fee ?? null,
    };
  } finally {
    await destroyProviderQuietly(provider);
  }
}
