import type { CreateJobInput } from "../../backend/sdk/dist/index.js";
import { Contract, formatUnits, getAddress, JsonRpcProvider } from "ethers";
import { readJsonConfig } from "../lib/config.ts";
import { API_URL, userClient } from "../lib/sdk-client.ts";
import {
  env,
  sendPreparedTransaction,
  signerWallet,
} from "../lib/transactions.ts";

const ESCROW_ABI = [
  "function paymentToken() view returns (address)",
  "function registry() view returns (address)",
] as const;

const REGISTRY_ABI = [
  "function getProvider(uint256 providerId) view returns (tuple(address owner, address signer, address payoutWallet, uint256 price, uint64 workTimeout, uint8 status, uint8 trustLevel, bytes32 metadataCommitment))",
] as const;

const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;

async function providerPriceFromChain(
  escrowAddress: string,
  registryProviderId: string,
): Promise<bigint> {
  const rpcProvider = new JsonRpcProvider(env("RPC_URL"));
  const escrow = new Contract(
    getAddress(escrowAddress),
    ESCROW_ABI,
    rpcProvider,
  );
  const registryAddress = getAddress((await escrow.registry()) as string);
  const registry = new Contract(registryAddress, REGISTRY_ABI, rpcProvider);
  const registered = (await registry.getProvider(registryProviderId)) as {
    price: bigint;
  };
  return registered.price;
}

async function ensurePaymentAllowance(
  userWallet: string,
  escrowAddress: string,
  registryProviderId: string,
) {
  const wallet = signerWallet().connect(new JsonRpcProvider(env("RPC_URL")));
  const escrow = getAddress(escrowAddress);
  const signerAddress = getAddress(wallet.address);
  const expectedUser = getAddress(userWallet);

  if (signerAddress !== expectedUser) {
    throw new Error(
      `SIGNER_WALLET_PK signs for ${signerAddress}, but job user_wallet is ${expectedUser}`,
    );
  }

  const requiredPayment = await providerPriceFromChain(
    escrow,
    registryProviderId,
  );

  const escrowContract = new Contract(escrow, ESCROW_ABI, wallet);
  const paymentTokenAddress = getAddress(
    (await escrowContract.paymentToken()) as string,
  );
  const paymentToken = new Contract(paymentTokenAddress, ERC20_ABI, wallet);
  const allowance = (await paymentToken.allowance(
    expectedUser,
    escrow,
  )) as bigint;

  console.log("\nPayment token allowance:");
  console.log(
    JSON.stringify(
      {
        token: paymentTokenAddress,
        owner: expectedUser,
        spender: escrow,
        allowance: formatUnits(allowance, 6),
        required: formatUnits(requiredPayment, 6),
      },
      null,
      2,
    ),
  );

  if (allowance >= requiredPayment) {
    console.log("Allowance is sufficient.");
    return;
  }

  console.log("Allowance is insufficient, approving payment token...");
  const response = await paymentToken.approve(escrow, requiredPayment);
  console.log(`Approve transaction sent: ${response.hash}`);
  const receipt = await response.wait(1);

  console.log("Approve transaction confirmed:");
  console.log(
    JSON.stringify(
      {
        hash: receipt?.hash,
        block_number: receipt?.blockNumber,
        status: receipt?.status,
      },
      null,
      2,
    ),
  );
}

const job = await readJsonConfig<CreateJobInput>("./config/job.json");

console.log(`Skill Hub API: ${API_URL}`);
console.log("Creating job payload:");
console.log(JSON.stringify(job, null, 2));

const signedUserClient = await userClient();
const transaction = await signedUserClient.jobs.create(job);

console.log("\nPrepared createJob transaction:");
console.log(JSON.stringify(transaction, null, 2));

if (process.env.SIGNER_WALLET_PK?.trim()) {
  await ensurePaymentAllowance(
    job.user_wallet,
    transaction.to,
    job.provider_id,
  );
} else {
  console.log(
    "\nSIGNER_WALLET_PK is not set, so allowance was not checked and approve was not sent.",
  );
}

await sendPreparedTransaction("createJob", transaction, {
  expectedSigner: job.user_wallet,
});
