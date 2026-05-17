import "dotenv/config";

import fs from "fs";
import path from "path";
import { Contract, ContractFactory, ContractInterface, Wallet, providers } from "ethers";

type FoundryArtifact = {
  abi: ContractInterface;
  bytecode: {
    object: string;
  };
};

type Deployment = {
  chainId: number;
  deployer: string;
  contracts: {
    AgentHubConfig: string;
    AgentHubRegistry: string;
    AgentHubEscrow: string;
  };
  constructorArgs: {
    AgentHubConfig: unknown[];
    AgentHubRegistry: unknown[];
    AgentHubEscrow: unknown[];
  };
};

const ROOT = path.resolve(__dirname, "..");

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function optionalAddress(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

function readArtifact(contractName: string): FoundryArtifact {
  const artifactPath = path.join(ROOT, "out", `${contractName}.sol`, `${contractName}.json`);
  const rawArtifact = fs.readFileSync(artifactPath, "utf8");
  return JSON.parse(rawArtifact) as FoundryArtifact;
}

function numberEnv(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue || rawValue.trim() === "") return fallback;

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }

  return value;
}

async function deployContract(
  name: string,
  wallet: Wallet,
  args: unknown[]
): Promise<Contract> {
  const artifact = readArtifact(name);
  const factory = new ContractFactory(artifact.abi, artifact.bytecode.object, wallet);
  const contract = await factory.deploy(...args);

  console.log(`${name} deployment tx: ${contract.deployTransaction.hash}`);
  await contract.deployed();
  console.log(`${name} deployed at: ${contract.address}`);

  return contract;
}

function writeDeployment(deployment: Deployment): void {
  const deploymentsDir = path.join(ROOT, "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const outputPath = path.join(deploymentsDir, `${deployment.chainId}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`Deployment written to: ${path.relative(ROOT, outputPath)}`);
}

async function main(): Promise<void> {
  const provider = new providers.JsonRpcProvider(requiredEnv("RPC_URL"));
  const wallet = new Wallet(requiredEnv("PRIVATE_KEY"), provider);
  const deployer = await wallet.getAddress();
  const network = await provider.getNetwork();

  console.log(`Deploying AgentHub contracts to chain ${network.chainId}`);
  console.log(`Deployer: ${deployer}`);

  const configArgs = [
    optionalAddress("OWNER_ADDRESS", deployer),
    requiredEnv("PAYMENT_TOKEN_ADDRESS"),
    requiredEnv("TREASURY_ADDRESS"),
    numberEnv("PROTOCOL_FEE_BPS", 250),
    optionalAddress("DELIVERY_ATTESTER_ADDRESS", deployer),
    numberEnv("REVIEW_TIMEOUT_SECONDS", 12 * 60 * 60),
    numberEnv("REFUND_GRACE_PERIOD_SECONDS", 24 * 60 * 60)
  ];

  const config = await deployContract("AgentHubConfig", wallet, configArgs);
  const registryArgs = [config.address];
  const registry = await deployContract("AgentHubRegistry", wallet, registryArgs);
  const escrowArgs = [config.address, registry.address];
  const escrow = await deployContract("AgentHubEscrow", wallet, escrowArgs);

  writeDeployment({
    chainId: network.chainId,
    deployer,
    contracts: {
      AgentHubConfig: config.address,
      AgentHubRegistry: registry.address,
      AgentHubEscrow: escrow.address
    },
    constructorArgs: {
      AgentHubConfig: configArgs,
      AgentHubRegistry: registryArgs,
      AgentHubEscrow: escrowArgs
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
