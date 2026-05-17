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

type Service = {
  price: BigNumber;
};

type CreateJobArgs = {
  service_id: string | number;
  request_id: string;
  input_commitment: string;
  queue_timeout_seconds: string | number;
  expires_at: string | number;
  delivery_attester_signature: string;
};

type CreateJobInput = {
  create_job_args?: CreateJobArgs;
} & Partial<CreateJobArgs>;

type EthersError = {
  reason?: string;
  data?: string;
  error?: EthersError;
};

const ROOT = path.resolve(__dirname, "..");
const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];
const USAGE = [
  "Usage:",
  "  npm run create-job -- '{\"create_job_args\":{...}}'",
  "  npm run create-job -- --file create-job-args.json",
  "",
  "Env:",
  "  RPC_URL",
  "  WALLET_USER_PRIVATE_KEY",
  "  AGENT_HUB_ESCROW_ADDRESS or ESCROW_CONTRACT_ADDRESS (optional if deployments/<chainId>.json exists)"
].join("\n");
const MAX_SAFE_INTEGER_BN = BigNumber.from(Number.MAX_SAFE_INTEGER.toString());

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
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
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

function asCreateJobArgs(input: unknown): CreateJobArgs {
  if (typeof input !== "object" || input === null) {
    throw new Error("Input must be a JSON object");
  }

  const objectInput = input as CreateJobInput;
  const args = objectInput.create_job_args ?? objectInput;

  const requiredFields: Array<keyof CreateJobArgs> = [
    "service_id",
    "request_id",
    "input_commitment",
    "queue_timeout_seconds",
    "expires_at",
    "delivery_attester_signature"
  ];

  for (const field of requiredFields) {
    if (args[field] === undefined || args[field] === null || `${args[field]}`.trim() === "") {
      throw new Error(`Missing create_job_args.${field}`);
    }
  }

  if (!utils.isHexString(args.request_id, 32)) {
    throw new Error("create_job_args.request_id must be bytes32");
  }
  if (!utils.isHexString(args.input_commitment, 32)) {
    throw new Error("create_job_args.input_commitment must be bytes32");
  }
  if (!utils.isHexString(args.delivery_attester_signature)) {
    throw new Error("create_job_args.delivery_attester_signature must be hex bytes");
  }

  return args as CreateJobArgs;
}

function asUint(value: string | number, fieldName: string): BigNumber {
  const raw = String(value);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`create_job_args.${fieldName} must be a non-negative integer`);
  }

  return BigNumber.from(raw);
}

function asUint64(value: string | number, fieldName: string): number {
  const raw = Number(value);
  if (!Number.isSafeInteger(raw) || raw < 0) {
    throw new Error(`create_job_args.${fieldName} must be a non-negative safe integer`);
  }

  return raw;
}

function formatUnixSeconds(value: BigNumber): string {
  if (!value.lte(MAX_SAFE_INTEGER_BN)) return value.toString();
  return new Date(value.toNumber() * 1000).toISOString();
}

function getUserPrivateKey(): string {
  const privateKey = firstEnv(["WALLET_USER_PRIVATE_KEY", "USER_PRIVATE_KEY"]);
  if (!privateKey) {
    throw new Error("Missing required env var: WALLET_USER_PRIVATE_KEY");
  }

  const normalizedPrivateKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  if (!utils.isHexString(normalizedPrivateKey, 32)) {
    throw new Error("WALLET_USER_PRIVATE_KEY must be a 32-byte hex private key");
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
    return new Error(`AgentHubEscrow.createJob would revert: ${parsedError.name}${args}`);
  } catch {
    return new Error(`Transaction simulation failed with raw revert data: ${data}`);
  }
}

async function readOptionalTokenString(token: Contract, field: "symbol"): Promise<string> {
  try {
    return await token[field]();
  } catch {
    return "token";
  }
}

async function readOptionalTokenDecimals(token: Contract): Promise<number> {
  try {
    return await token.decimals();
  } catch {
    return 0;
  }
}

async function ensurePaymentAllowance(
  escrow: Contract,
  wallet: Wallet,
  userAddress: string,
  serviceId: BigNumber,
  escrowAddress: string
): Promise<void> {
  const paymentTokenAddress = await escrow.paymentToken();
  const registryAddress = await escrow.registry();
  const registryArtifact = readArtifact("AgentHubRegistry");
  const registry = new Contract(registryAddress, registryArtifact.abi, wallet);
  const service = await registry.getService(serviceId) as Service;
  const token = new Contract(paymentTokenAddress, ERC20_ABI, wallet);
  const [symbol, decimals, allowance, balance] = await Promise.all([
    readOptionalTokenString(token, "symbol"),
    readOptionalTokenDecimals(token),
    token.allowance(userAddress, escrowAddress) as Promise<BigNumber>,
    token.balanceOf(userAddress) as Promise<BigNumber>
  ]);

  console.log(`Payment token: ${paymentTokenAddress}`);
  console.log(`Service price: ${utils.formatUnits(service.price, decimals)} ${symbol} (${service.price.toString()})`);
  console.log(`Current allowance: ${utils.formatUnits(allowance, decimals)} ${symbol} (${allowance.toString()})`);

  if (balance.lt(service.price)) {
    throw new Error(
      `Insufficient ${symbol} balance. ` +
        `Need ${utils.formatUnits(service.price, decimals)}, ` +
        `wallet has ${utils.formatUnits(balance, decimals)}.`
    );
  }

  if (allowance.gte(service.price)) {
    console.log("Allowance is sufficient; skipping approve.");
    return;
  }

  console.log(`Approving ${utils.formatUnits(service.price, decimals)} ${symbol} for escrow...`);
  const txArgs = [escrowAddress, service.price] as const;
  await token.callStatic.approve(...txArgs);
  const estimatedGas = await token.estimateGas.approve(...txArgs);
  const tx = await token.approve(...txArgs, { gasLimit: estimatedGas.mul(120).div(100) });

  console.log(`Approve transaction sent: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Approve transaction confirmed in block ${receipt.blockNumber}`);
}

async function main(): Promise<void> {
  const createJobArgs = asCreateJobArgs(parseCliInput());
  const provider = new providers.JsonRpcProvider(requiredEnv("RPC_URL"));
  const wallet = new Wallet(getUserPrivateKey(), provider);
  const network = await provider.getNetwork();
  const escrowAddress = getEscrowAddress(network.chainId);
  const artifact = readArtifact("AgentHubEscrow");
  const escrow = new Contract(escrowAddress, artifact.abi, wallet);

  const userAddress = await wallet.getAddress();
  const serviceId = asUint(createJobArgs.service_id, "service_id");
  const requestId = createJobArgs.request_id;
  const inputCommitment = createJobArgs.input_commitment;
  const queueTimeoutSeconds = asUint64(createJobArgs.queue_timeout_seconds, "queue_timeout_seconds");
  const expiresAt = asUint(createJobArgs.expires_at, "expires_at");
  const signature = createJobArgs.delivery_attester_signature;
  const latestBlock = await provider.getBlock("latest");

  console.log(`Calling AgentHubEscrow.createJob on chain ${network.chainId}`);
  console.log(`Escrow: ${escrowAddress}`);
  console.log(`User wallet: ${userAddress}`);
  console.log(`Authorization expires at: ${formatUnixSeconds(expiresAt)} (${expiresAt.toString()})`);

  if (expiresAt.lte(latestBlock.timestamp)) {
    throw new Error(
      `create_job_args.expires_at is expired for latest block timestamp ${latestBlock.timestamp}. ` +
        "Generate fresh create_job_args from the backend before calling createJob."
    );
  }

  await ensurePaymentAllowance(escrow, wallet, userAddress, serviceId, escrowAddress);

  const txArgs = [serviceId, requestId, inputCommitment, queueTimeoutSeconds, expiresAt, signature] as const;
  let gasLimit: BigNumber;
  try {
    await escrow.callStatic.createJob(...txArgs);
    const estimatedGas = await escrow.estimateGas.createJob(...txArgs);
    gasLimit = estimatedGas.mul(120).div(100);
  } catch (error) {
    throw explainContractError(error as EthersError, escrow.interface);
  }

  const tx = await escrow.createJob(...txArgs, { gasLimit });

  console.log(`Transaction sent: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Transaction confirmed in block ${receipt.blockNumber}`);

  const jobCreated = receipt.events?.find((event: { event?: string }) => event.event === "JobCreated");
  const jobId = jobCreated?.args?.jobId;
  if (jobId) {
    console.log(`Job created: ${jobId.toString()}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
