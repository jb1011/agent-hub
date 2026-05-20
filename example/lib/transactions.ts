import type { PreparedContractTransaction } from "../../backend/sdk/dist/index.js";
import { getAddress, JsonRpcProvider, Wallet } from "ethers";

export function env(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value && value.trim() !== "") return value.trim();
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${name}`);
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

function normalizePrivateKey(privateKey: string): string {
  return privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
}

export async function sendPreparedTransaction(
  label: string,
  transaction: PreparedContractTransaction,
  expectedSigner?: string
) {
  const providerOwnerPk = optionalEnv("PROVIDER_OWNER_PK");
  if (!providerOwnerPk) {
    console.log("\nPROVIDER_OWNER_PK is not set, so the transaction was not sent.");
    console.log("Set PROVIDER_OWNER_PK and RPC_URL to sign and broadcast it from this script.");
    return;
  }

  const rpcUrl = env("RPC_URL");
  const rpcProvider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(normalizePrivateKey(providerOwnerPk), rpcProvider);
  const signerAddress = getAddress(wallet.address);
  const expectedAddress = expectedSigner ? getAddress(expectedSigner) : undefined;

  if (expectedAddress && signerAddress !== expectedAddress) {
    throw new Error(`PROVIDER_OWNER_PK signs for ${signerAddress}, but expected signer is ${expectedAddress}`);
  }

  if (transaction.chain_id !== undefined) {
    const network = await rpcProvider.getNetwork();
    const rpcChainId = Number(network.chainId);
    if (rpcChainId !== transaction.chain_id) {
      throw new Error(`RPC_URL chain id is ${rpcChainId}, but prepared transaction expects ${transaction.chain_id}`);
    }
  }

  console.log(`\nSending ${label} transaction from ${signerAddress}...`);
  const response = await wallet.sendTransaction({
    to: transaction.to,
    data: transaction.data,
    value: BigInt(transaction.value),
  });

  console.log(`Transaction sent: ${response.hash}`);
  const receipt = await response.wait(1);

  console.log("Transaction confirmed:");
  console.log(JSON.stringify({
    hash: receipt?.hash,
    block_number: receipt?.blockNumber,
    status: receipt?.status,
  }, null, 2));
}
