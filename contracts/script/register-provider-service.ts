import "dotenv/config";

import fs from "fs";
import path from "path";
import { BigNumber, Contract, ContractInterface, Wallet, providers, utils } from "ethers";

type FoundryArtifact = {
  abi: ContractInterface;
};

type Deployment = {
  contracts?: {
    AgentHubRegistry?: string;
  };
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type ProviderMetadata = {
  provider_id: string;
  name: string;
  description: string;
  status: string;
  owner_wallet: string;
  payout_wallet: string;
  api_base_url: string;
  trust_level: string;
  created_at: string;
  updated_at: string;
};

type ServiceMetadata = {
  service_id: string;
  provider_id: string;
  name: string;
  description: string;
  service_type: string;
  endpoint_path: string;
  input_schema: JsonValue;
  output_schema: JsonValue;
  price_usdc: string;
  timeout_seconds: number;
  status: string;
  created_at: string;
  updated_at: string;
};

type EthersError = {
  reason?: string;
  data?: string;
  error?: EthersError;
};

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PROVIDER: ProviderMetadata = {
  provider_id: "1",
  name: "Demo Provider",
  description: "A demo service provider for development",
  status: "ACTIVE",
  owner_wallet: "0x0000000000000000000000000000000000000001",
  payout_wallet: "0x0000000000000000000000000000000000000001",
  api_base_url: "https://demo.example.com",
  trust_level: "VERIFIED",
  created_at: "2026-05-16T22:17:59.003Z",
  updated_at: "2026-05-16T22:17:59.003Z"
};
const DEFAULT_SERVICE: ServiceMetadata = {
  service_id: "1",
  provider_id: "1",
  name: "Demo Text Processing",
  description: "A demo text processing service",
  service_type: "AI",
  endpoint_path: "/process",
  input_schema: null,
  output_schema: null,
  price_usdc: "1",
  timeout_seconds: 60,
  status: "ACTIVE",
  created_at: "2026-05-16T22:17:59.008Z",
  updated_at: "2026-05-16T22:17:59.008Z"
};
const USAGE = [
  "Usage:",
  "  npm run register-provider-service",
  "  npm run register-provider-service -- --provider-file provider.json --service-file service.json",
  "",
  "Env:",
  "  RPC_URL",
  "  WALLET_PROVIDER_PRIVATE_KEY",
  "  AGENT_HUB_REGISTRY_ADDRESS or REGISTRY_CONTRACT_ADDRESS (optional if deployments/<chainId>.json exists)",
  "",
  "Notes:",
  "  registerProvider owner is msg.sender, so owner_wallet must match WALLET_PROVIDER_PRIVATE_KEY if you need exact parity.",
  "  price_usdc is converted to USDC base units with 6 decimals."
].join("\n");

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

function readJsonFile<T>(filePath: string): T {
  const resolvedPath = resolveJsonFilePath(filePath);
  return JSON.parse(fs.readFileSync(resolvedPath, "utf8")) as T;
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

function parseCliInput(): { providerMetadata: ProviderMetadata; serviceMetadata: ServiceMetadata } {
  const args = process.argv.slice(2);
  if (args[0] === "--help" || args[0] === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  let providerMetadata = DEFAULT_PROVIDER;
  let serviceMetadata = DEFAULT_SERVICE;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--provider-file") {
      if (!next) throw new Error("Missing file path after --provider-file");
      providerMetadata = readJsonFile<ProviderMetadata>(next);
      index += 1;
      continue;
    }

    if (arg === "--service-file") {
      if (!next) throw new Error("Missing file path after --service-file");
      serviceMetadata = readJsonFile<ServiceMetadata>(next);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}\n\n${USAGE}`);
  }

  return { providerMetadata, serviceMetadata };
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

function getRegistryAddress(chainId: number): string {
  const envAddress = firstEnv(["AGENT_HUB_REGISTRY_ADDRESS", "REGISTRY_CONTRACT_ADDRESS"]);
  if (envAddress) return utils.getAddress(envAddress);

  const deploymentPath = path.join(ROOT, "deployments", `${chainId}.json`);
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as Deployment;
  const deploymentAddress = deployment.contracts?.AgentHubRegistry;
  if (!deploymentAddress) {
    throw new Error(`AgentHubRegistry address not found in ${path.relative(ROOT, deploymentPath)}`);
  }

  return utils.getAddress(deploymentAddress);
}

function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function metadataCommitment(metadata: JsonValue): string {
  return utils.keccak256(utils.toUtf8Bytes(stableStringify(metadata)));
}

function parseUsdc(value: string): BigNumber {
  if (!/^\d+(\.\d{1,6})?$/.test(value)) {
    throw new Error("service.price_usdc must be a positive decimal with up to 6 decimals");
  }

  const amount = utils.parseUnits(value, 6);
  if (amount.isZero()) throw new Error("service.price_usdc must be greater than 0");
  return amount;
}

function asUint64(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive safe integer`);
  }

  return value;
}

function findErrorData(error: EthersError): string | undefined {
  if (typeof error.data === "string" && utils.isHexString(error.data)) return error.data;
  if (error.error) return findErrorData(error.error);
  return undefined;
}

function explainContractError(error: EthersError, contractInterface: utils.Interface, action: string): Error {
  const data = findErrorData(error);
  if (!data || data === "0x") {
    return new Error(error.reason ?? `${action} simulation failed`);
  }

  try {
    const parsedError = contractInterface.parseError(data);
    const args = parsedError.args.length > 0
      ? `(${parsedError.args.map((arg) => arg.toString()).join(", ")})`
      : "";
    return new Error(`${action} would revert: ${parsedError.name}${args}`);
  } catch {
    return new Error(`${action} simulation failed with raw revert data: ${data}`);
  }
}

async function main(): Promise<void> {
  const { providerMetadata, serviceMetadata } = parseCliInput();
  const provider = new providers.JsonRpcProvider(requiredEnv("RPC_URL"));
  const wallet = new Wallet(getProviderPrivateKey(), provider);
  const network = await provider.getNetwork();
  const registryAddress = getRegistryAddress(network.chainId);
  const artifact = readArtifact("AgentHubRegistry");
  const registry = new Contract(registryAddress, artifact.abi, wallet);

  const providerWalletAddress = await wallet.getAddress();
  const payoutWallet = utils.getAddress(providerMetadata.payout_wallet);
  const providerOwnerWallet = utils.getAddress(providerMetadata.owner_wallet);
  const providerCommitment = metadataCommitment(providerMetadata as unknown as JsonValue);
  const serviceCommitment = metadataCommitment(serviceMetadata as unknown as JsonValue);
  const servicePrice = parseUsdc(serviceMetadata.price_usdc);
  const serviceTimeout = asUint64(serviceMetadata.timeout_seconds, "service.timeout_seconds");

  console.log(`Calling AgentHubRegistry on chain ${network.chainId}`);
  console.log(`Registry: ${registryAddress}`);
  console.log(`Provider wallet: ${providerWalletAddress}`);
  console.log(`Payout wallet: ${payoutWallet}`);
  console.log(`Provider metadata commitment: ${providerCommitment}`);
  console.log(`Service metadata commitment: ${serviceCommitment}`);
  console.log(`Service price: ${servicePrice.toString()} USDC base units`);

  if (providerOwnerWallet !== providerWalletAddress) {
    console.warn(
      `Warning: provider.owner_wallet is ${providerOwnerWallet}, but registerProvider owner will be ${providerWalletAddress}.`
    );
  }

  let providerGasLimit: BigNumber;
  try {
    await registry.callStatic.registerProvider(providerWalletAddress, payoutWallet, providerCommitment);
    const estimatedGas = await registry.estimateGas.registerProvider(
      providerWalletAddress,
      payoutWallet,
      providerCommitment
    );
    providerGasLimit = estimatedGas.mul(120).div(100);
  } catch (error) {
    throw explainContractError(error as EthersError, registry.interface, "AgentHubRegistry.registerProvider");
  }

  const providerTx = await registry.registerProvider(
    providerWalletAddress,
    payoutWallet,
    providerCommitment,
    { gasLimit: providerGasLimit }
  );
  console.log(`Provider transaction sent: ${providerTx.hash}`);

  const providerReceipt = await providerTx.wait();
  console.log(`Provider transaction confirmed in block ${providerReceipt.blockNumber}`);

  const providerRegistered = providerReceipt.events?.find(
    (event: { event?: string }) => event.event === "ProviderRegistered"
  );
  const providerId = providerRegistered?.args?.providerId as BigNumber | undefined;
  if (!providerId) throw new Error("ProviderRegistered event not found");
  console.log(`Provider registered: ${providerId.toString()}`);

  let serviceGasLimit: BigNumber;
  try {
    await registry.callStatic.registerService(providerId, servicePrice, serviceTimeout, serviceCommitment);
    const estimatedGas = await registry.estimateGas.registerService(
      providerId,
      servicePrice,
      serviceTimeout,
      serviceCommitment
    );
    serviceGasLimit = estimatedGas.mul(120).div(100);
  } catch (error) {
    throw explainContractError(error as EthersError, registry.interface, "AgentHubRegistry.registerService");
  }

  const serviceTx = await registry.registerService(
    providerId,
    servicePrice,
    serviceTimeout,
    serviceCommitment,
    { gasLimit: serviceGasLimit }
  );
  console.log(`Service transaction sent: ${serviceTx.hash}`);

  const serviceReceipt = await serviceTx.wait();
  console.log(`Service transaction confirmed in block ${serviceReceipt.blockNumber}`);

  const serviceRegistered = serviceReceipt.events?.find(
    (event: { event?: string }) => event.event === "ServiceRegistered"
  );
  const serviceId = serviceRegistered?.args?.serviceId as BigNumber | undefined;
  if (!serviceId) throw new Error("ServiceRegistered event not found");
  console.log(`Service registered: ${serviceId.toString()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
