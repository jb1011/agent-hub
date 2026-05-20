import type { CreateJobInput } from "../../backend/sdk/dist/index.js";
import { Contract, formatUnits, getAddress, JsonRpcProvider, parseUnits } from "ethers";
import { readJsonConfig } from "../lib/config.ts";
import { API_URL, client } from "../lib/sdk-client.ts";
import { env, sendPreparedTransaction, signerWallet } from "../lib/transactions.ts";

const ESCROW_ABI = [
  "function paymentToken() view returns (address)",
] as const;

const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;

async function ensurePaymentAllowance(userWallet: string, escrowAddress: string, amount: bigint) {
  const wallet = signerWallet().connect(new JsonRpcProvider(env("RPC_URL")));
  const escrow = getAddress(escrowAddress);
  const signerAddress = getAddress(wallet.address);
  const expectedUser = getAddress(userWallet);

  if (signerAddress !== expectedUser) {
    throw new Error(`SIGNER_WALLET_PK signs for ${signerAddress}, but job user_wallet is ${expectedUser}`);
  }

  const escrowContract = new Contract(escrow, ESCROW_ABI, wallet);
  const paymentTokenAddress = getAddress(await escrowContract.paymentToken() as string);
  const paymentToken = new Contract(paymentTokenAddress, ERC20_ABI, wallet);
  const allowance = await paymentToken.allowance(expectedUser, escrow) as bigint;

  console.log("\nPayment token allowance:");
  console.log(JSON.stringify({
    token: paymentTokenAddress,
    owner: expectedUser,
    spender: escrow,
    allowance: formatUnits(allowance, 6),
    required: formatUnits(amount, 6),
  }, null, 2));

  if (allowance >= amount) {
    console.log("Allowance is sufficient.");
    return;
  }

  console.log("Allowance is insufficient, approving payment token...");
  const response = await paymentToken.approve(escrow, amount);
  console.log(`Approve transaction sent: ${response.hash}`);
  const receipt = await response.wait(1);

  console.log("Approve transaction confirmed:");
  console.log(JSON.stringify({
    hash: receipt?.hash,
    block_number: receipt?.blockNumber,
    status: receipt?.status,
  }, null, 2));
}

const job = await readJsonConfig<CreateJobInput>("./config/job.json");

console.log(`Skill Hub API: ${API_URL}`);
console.log("Creating job payload:");
console.log(JSON.stringify(job, null, 2));

const transaction = await client.jobs.create(job);

console.log("\nPrepared createJob transaction:");
console.log(JSON.stringify(transaction, null, 2));

const provider = await client.providers.get(job.provider_id);
const requiredPayment = parseUnits(provider.price_usdc, 6);

if (process.env.SIGNER_WALLET_PK?.trim()) {
  await ensurePaymentAllowance(job.user_wallet, transaction.to, requiredPayment);
} else {
  console.log("\nSIGNER_WALLET_PK is not set, so allowance was not checked and approve was not sent.");
}

await sendPreparedTransaction("createJob", transaction, {
  expectedSigner: job.user_wallet,
});
