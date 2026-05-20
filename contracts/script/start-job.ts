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

type StartJobArgs = {
  job_id: string | number;
  expires_at: string | number;
  provider_signature: string;
};

type StartJobInput = {
  start_job_args?: StartJobArgs;
} & Partial<StartJobArgs>;

type EthersError = {
  reason?: string;
  data?: string;
  error?: EthersError;
};

type Job = {
  providerId: BigNumber;
  serviceId: BigNumber;
  queueDeadline: BigNumber;
  workTimeout: BigNumber;
  status: number;
  inputCommitment: string;
};

const ROOT = path.resolve(__dirname, "..");
const USAGE = [
  "Usage:",
  "  npm run start-job -- '{\"start_job_args\":{...}}'",
  "  npm run start-job -- --file args/start-job-args.json",
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

function asStartJobArgs(input: unknown): StartJobArgs {
  if (typeof input !== "object" || input === null) {
    throw new Error("Input must be a JSON object");
  }

  const objectInput = input as StartJobInput;
  const args = objectInput.start_job_args ?? objectInput;
  const requiredFields: Array<keyof StartJobArgs> = ["job_id", "expires_at", "provider_signature"];

  for (const field of requiredFields) {
    if (args[field] === undefined || args[field] === null || `${args[field]}`.trim() === "") {
      throw new Error(`Missing start_job_args.${field}`);
    }
  }

  if (!utils.isHexString(args.provider_signature)) {
    throw new Error("start_job_args.provider_signature must be hex bytes");
  }

  return args as StartJobArgs;
}

function asUint(value: string | number, fieldName: string): BigNumber {
  const raw = String(value);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`start_job_args.${fieldName} must be a non-negative integer`);
  }

  return BigNumber.from(raw);
}

function formatUnixSeconds(value: BigNumber): string {
  if (!value.lte(MAX_SAFE_INTEGER_BN)) return value.toString();
  return new Date(value.toNumber() * 1000).toISOString();
}

function formatUintSeconds(value: BigNumber): string {
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
    return new Error(`AgentHubEscrow.startJob would revert: ${parsedError.name}${args}`);
  } catch {
    return new Error(`Transaction simulation failed with raw revert data: ${data}`);
  }
}

async function main(): Promise<void> {
  const startJobArgs = asStartJobArgs(parseCliInput());
  const provider = new providers.JsonRpcProvider(requiredEnv("RPC_URL"));
  const wallet = new Wallet(getProviderPrivateKey(), provider);
  const network = await provider.getNetwork();
  const escrowAddress = getEscrowAddress(network.chainId);
  const artifact = readArtifact("AgentHubEscrow");
  const escrow = new Contract(escrowAddress, artifact.abi, wallet);

  const callerAddress = await wallet.getAddress();
  const jobId = asUint(startJobArgs.job_id, "job_id");
  const expiresAt = asUint(startJobArgs.expires_at, "expires_at");
  const signature = startJobArgs.provider_signature;
  const latestBlock = await provider.getBlock("latest");
  const job = await escrow.getJob(jobId) as Job;
  const statusName = JOB_STATUSES[job.status] ?? `UNKNOWN(${job.status})`;

  console.log(`Calling AgentHubEscrow.startJob on chain ${network.chainId}`);
  console.log(`Escrow: ${escrowAddress}`);
  console.log(`Caller wallet: ${callerAddress}`);
  console.log(`Job: ${jobId.toString()}`);
  console.log(`Provider: ${job.providerId.toString()}`);
  console.log(`Service: ${job.serviceId.toString()}`);
  console.log(`Status: ${statusName}`);
  console.log(`Queue deadline: ${formatUintSeconds(job.queueDeadline)} (${job.queueDeadline.toString()})`);
  console.log(`Authorization expires at: ${formatUnixSeconds(expiresAt)} (${expiresAt.toString()})`);

  if (job.status !== 1) {
    throw new Error(`Job ${jobId.toString()} must be FUNDED before startJob; current status is ${statusName}.`);
  }

  if (BigNumber.from(latestBlock.timestamp).gt(job.queueDeadline)) {
    throw new Error(
      `Job ${jobId.toString()} queue deadline is expired for latest block timestamp ${latestBlock.timestamp}.`
    );
  }

  if (expiresAt.lte(latestBlock.timestamp)) {
    throw new Error(
      `start_job_args.expires_at is expired for latest block timestamp ${latestBlock.timestamp}. ` +
        "Generate fresh start_job_args from the backend before calling startJob."
    );
  }

  const txArgs = [jobId, expiresAt, signature] as const;
  let gasLimit: BigNumber;
  try {
    await escrow.callStatic.startJob(...txArgs);
    const estimatedGas = await escrow.estimateGas.startJob(...txArgs);
    gasLimit = estimatedGas.mul(120).div(100);
  } catch (error) {
    throw explainContractError(error as EthersError, escrow.interface);
  }

  const tx = await escrow.startJob(...txArgs, { gasLimit });

  console.log(`Transaction sent: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Transaction confirmed in block ${receipt.blockNumber}`);

  const jobStarted = receipt.events?.find((event: { event?: string }) => event.event === "JobStarted");
  if (jobStarted?.args) {
    console.log(`Job started: ${jobStarted.args.jobId.toString()}`);
    console.log(
      `Work deadline: ${formatUintSeconds(jobStarted.args.workDeadline)} ` +
        `(${jobStarted.args.workDeadline.toString()})`
    );
    console.log(
      `Final refund deadline: ${formatUintSeconds(jobStarted.args.finalRefundDeadline)} ` +
        `(${jobStarted.args.finalRefundDeadline.toString()})`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
