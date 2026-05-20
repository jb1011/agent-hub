import "dotenv/config";

import fs from "fs";
import path from "path";
import { BigNumber, Contract, ContractInterface, Wallet, providers, utils } from "ethers";

type FoundryArtifact = {
  abi: ContractInterface;
};

type Deployment = {
  contracts?: {
    AgentHubEscrow?: string;
  };
};

type SettleWithUserSignatureArgs = {
  job_id: string | number;
  output_commitment: string;
  expires_at: string | number;
  user_signature: string;
};

type SettleWithUserSignatureInput = {
  settle_with_user_signature_args?: SettleWithUserSignatureArgs;
} & Partial<SettleWithUserSignatureArgs>;

type EthersError = {
  reason?: string;
  data?: string;
  error?: EthersError;
};

type Job = {
  providerId: BigNumber;
  workDeadline: BigNumber;
  finalRefundDeadline: BigNumber;
  status: number;
  inputCommitment: string;
};

const ROOT = path.resolve(__dirname, "..");
const USAGE = [
  "Usage:",
  "  npm run settle-with-user-signature -- '{\"settle_with_user_signature_args\":{...}}'",
  "  npm run settle-with-user-signature -- --file args/settle-with-user-signature-args.json",
  "",
  "Env:",
  "  RPC_URL",
  "  WALLET_PROVIDER_PRIVATE_KEY",
  "  AGENT_HUB_ESCROW_ADDRESS or ESCROW_CONTRACT_ADDRESS (optional if deployments/<chainId>.json exists)"
].join("\n");
const MAX_SAFE_INTEGER_BN = BigNumber.from(Number.MAX_SAFE_INTEGER.toString());
const JOB_STATUSES = ["NONE", "FUNDED", "RUNNING", "SETTLED", "REFUNDED"];

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function firstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim() !== "") return value.trim();
  }

  return undefined;
}

function readArtifact(contractName: string): FoundryArtifact {
  const artifactPath = path.join(ROOT, "out", `${contractName}.sol`, `${contractName}.json`);
  const rawArtifact = fs.readFileSync(artifactPath, "utf8");
  return JSON.parse(rawArtifact) as FoundryArtifact;
}

function readJsonFile(filePath: string): unknown {
  const resolvedPath = resolveJsonFilePath(filePath);
  return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
}

function resolveJsonFilePath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;

  const candidates = [
    path.resolve(process.cwd(), filePath),
    path.resolve(ROOT, filePath)
  ];

  if (path.dirname(filePath) === ".") {
    candidates.push(path.resolve(ROOT, "args", filePath));
  }

  const resolvedPath = candidates.find((candidate) => fs.existsSync(candidate));
  return resolvedPath ?? candidates[0];
}

function parseCliInput(): unknown {
  const args = process.argv.slice(2);

  if (args[0] === "--help" || args[0] === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  if (args.length === 0) {
    throw new Error(USAGE);
  }

  if (args[0] === "--file" || args[0] === "-f") {
    if (!args[1]) throw new Error("Missing file path after --file");
    return readJsonFile(args[1]);
  }

  return JSON.parse(args.join(" "));
}

function asSettleArgs(input: unknown): SettleWithUserSignatureArgs {
  if (typeof input !== "object" || input === null) {
    throw new Error("Input must be a JSON object");
  }

  const objectInput = input as SettleWithUserSignatureInput;
  const args = objectInput.settle_with_user_signature_args ?? objectInput;
  const requiredFields: Array<keyof SettleWithUserSignatureArgs> = [
    "job_id",
    "output_commitment",
    "expires_at",
    "user_signature"
  ];

  for (const field of requiredFields) {
    if (args[field] === undefined || args[field] === null || `${args[field]}`.trim() === "") {
      throw new Error(`Missing settle_with_user_signature_args.${field}`);
    }
  }

  if (!utils.isHexString(args.output_commitment, 32)) {
    throw new Error("settle_with_user_signature_args.output_commitment must be bytes32");
  }
  if (args.output_commitment === utils.hexZeroPad("0x", 32)) {
    throw new Error("settle_with_user_signature_args.output_commitment must be non-zero");
  }
  if (!utils.isHexString(args.user_signature)) {
    throw new Error("settle_with_user_signature_args.user_signature must be hex bytes");
  }

  return args as SettleWithUserSignatureArgs;
}

function asUint(value: string | number, fieldName: string): BigNumber {
  const raw = String(value);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`settle_with_user_signature_args.${fieldName} must be a non-negative integer`);
  }

  return BigNumber.from(raw);
}

function formatUnixSeconds(value: BigNumber): string {
  if (!value.lte(MAX_SAFE_INTEGER_BN)) return value.toString();
  return new Date(value.toNumber() * 1000).toISOString();
}

function getProviderPrivateKey(): string {
  const privateKey = firstEnv([
    "WALLET_PROVIDER_PRIVATE_KEY",
    "PROVIDER_PRIVATE_KEY",
    "WALLET_PROVIDER",
    "wallet_provider"
  ]);
  if (!privateKey) {
    throw new Error("Missing required env var: WALLET_PROVIDER_PRIVATE_KEY");
  }

  const normalizedPrivateKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  if (!utils.isHexString(normalizedPrivateKey, 32)) {
    throw new Error("WALLET_PROVIDER_PRIVATE_KEY must be a 32-byte hex private key");
  }

  return normalizedPrivateKey;
}

function getEscrowAddress(chainId: number): string {
  const envAddress = firstEnv(["AGENT_HUB_ESCROW_ADDRESS", "ESCROW_CONTRACT_ADDRESS"]);
  if (envAddress) return utils.getAddress(envAddress);

  const deploymentPath = path.join(ROOT, "deployments", `${chainId}.json`);
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as Deployment;
  const deploymentAddress = deployment.contracts?.AgentHubEscrow;
  if (!deploymentAddress) {
    throw new Error(`AgentHubEscrow address not found in ${path.relative(ROOT, deploymentPath)}`);
  }

  return utils.getAddress(deploymentAddress);
}

function findErrorData(error: EthersError): string | undefined {
  if (typeof error.data === "string" && utils.isHexString(error.data)) return error.data;
  if (error.error) return findErrorData(error.error);
  return undefined;
}

function decodeRevertData(data: string): string | undefined {
  if (!data.startsWith("0x08c379a0")) return undefined;

  try {
    const encodedReason = `0x${data.slice(10)}`;
    const [reason] = utils.defaultAbiCoder.decode(["string"], encodedReason);
    return reason;
  } catch {
    return undefined;
  }
}

function explainContractError(error: EthersError, contractInterface: utils.Interface): Error {
  const data = findErrorData(error);
  if (!data || data === "0x") {
    return new Error(error.reason ?? "Transaction simulation failed");
  }

  const decodedError = decodeRevertData(data);
  if (decodedError) {
    return new Error(`Transaction simulation failed: ${decodedError}`);
  }

  try {
    const parsedError = contractInterface.parseError(data);
    const args = parsedError.args.length > 0
      ? `(${parsedError.args.map((arg) => arg.toString()).join(", ")})`
      : "";
    return new Error(`AgentHubEscrow.settleWithUserSignature would revert: ${parsedError.name}${args}`);
  } catch {
    return new Error(`Transaction simulation failed with raw revert data: ${data}`);
  }
}

async function main(): Promise<void> {
  const settleArgs = asSettleArgs(parseCliInput());
  const provider = new providers.JsonRpcProvider(requiredEnv("RPC_URL"));
  const wallet = new Wallet(getProviderPrivateKey(), provider);
  const network = await provider.getNetwork();
  const escrowAddress = getEscrowAddress(network.chainId);
  const artifact = readArtifact("AgentHubEscrow");
  const escrow = new Contract(escrowAddress, artifact.abi, wallet);

  const callerAddress = await wallet.getAddress();
  const jobId = asUint(settleArgs.job_id, "job_id");
  const outputCommitment = settleArgs.output_commitment;
  const expiresAt = asUint(settleArgs.expires_at, "expires_at");
  const userSignature = settleArgs.user_signature;
  const latestBlock = await provider.getBlock("latest");
  const job = await escrow.getJob(jobId) as Job;
  const statusName = JOB_STATUSES[job.status] ?? `UNKNOWN(${job.status})`;

  console.log(`Calling AgentHubEscrow.settleWithUserSignature on chain ${network.chainId}`);
  console.log(`Escrow: ${escrowAddress}`);
  console.log(`Provider wallet: ${callerAddress}`);
  console.log(`Job: ${jobId.toString()}`);
  console.log(`Provider: ${job.providerId.toString()}`);
  console.log(`Status: ${statusName}`);
  console.log(`Output commitment: ${outputCommitment}`);
  console.log(`Work deadline: ${formatUnixSeconds(job.workDeadline)} (${job.workDeadline.toString()})`);
  console.log(`Authorization expires at: ${formatUnixSeconds(expiresAt)} (${expiresAt.toString()})`);

  if (job.status !== 2) {
    throw new Error(`Job ${jobId.toString()} must be RUNNING before settlement; current status is ${statusName}.`);
  }

  if (expiresAt.lte(latestBlock.timestamp)) {
    throw new Error(
      `settle_with_user_signature_args.expires_at is expired for latest block timestamp ${latestBlock.timestamp}. ` +
        "Generate fresh settle_with_user_signature_args from the backend before calling settleWithUserSignature."
    );
  }

  const txArgs = [jobId, outputCommitment, expiresAt, userSignature] as const;
  let gasLimit: BigNumber;
  try {
    await escrow.callStatic.settleWithUserSignature(...txArgs);
    const estimatedGas = await escrow.estimateGas.settleWithUserSignature(...txArgs);
    gasLimit = estimatedGas.mul(120).div(100);
  } catch (error) {
    throw explainContractError(error as EthersError, escrow.interface);
  }

  const tx = await escrow.settleWithUserSignature(...txArgs, { gasLimit });

  console.log(`Transaction sent: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Transaction confirmed in block ${receipt.blockNumber}`);

  const settled = receipt.events?.find(
    (event: { event?: string }) => event.event === "JobSettledWithUserSignature"
  );
  if (settled?.args) {
    console.log(`Job settled: ${settled.args.jobId.toString()}`);
    console.log(`Provider payout wallet: ${settled.args.providerPayoutWallet}`);
    console.log(`Provider amount: ${settled.args.providerAmount.toString()}`);
    console.log(`Protocol fee: ${settled.args.protocolFee.toString()}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
