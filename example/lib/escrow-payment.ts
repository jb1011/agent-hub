import {
  Contract,
  formatUnits,
  getAddress,
  JsonRpcProvider,
  type InterfaceAbi,
} from "ethers";
import { env, signerWallet } from "./transactions.ts";

const ESCROW_ABI: InterfaceAbi = [
  "function paymentToken() view returns (address)",
  "function registry() view returns (address)",
];

const REGISTRY_ABI: InterfaceAbi = [
  "function getProvider(uint256 providerId) view returns (tuple(address owner, address signer, address payoutWallet, uint256 price, uint64 workTimeout, uint8 status, uint8 trustLevel, bytes32 metadataCommitment))",
];

const ERC20_ABI: InterfaceAbi = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

async function providerPriceFromChain(
  escrowAddress: string,
  registryProviderId: string,
): Promise<bigint> {
  const rpcProvider = new JsonRpcProvider(env("RPC_URL"));
  const escrow = new Contract(getAddress(escrowAddress), ESCROW_ABI, rpcProvider);
  const registryAddress = getAddress(String(await escrow.registry()));
  const registry = new Contract(registryAddress, REGISTRY_ABI, rpcProvider);
  const registered = (await registry.getProvider(BigInt(registryProviderId))) as {
    price: bigint;
  };
  return registered.price;
}

export async function ensurePaymentAllowance(
  userWallet: string,
  escrowAddress: string,
  registryProviderId: string,
): Promise<void> {
  const wallet = signerWallet().connect(new JsonRpcProvider(env("RPC_URL")));
  const escrow = getAddress(escrowAddress);
  const signerAddress = getAddress(wallet.address);
  const expectedUser = getAddress(userWallet);

  if (signerAddress !== expectedUser) {
    throw new Error(
      `SIGNER_WALLET_PK signs for ${signerAddress}, but job user_wallet is ${expectedUser}`,
    );
  }

  const requiredPayment = await providerPriceFromChain(escrow, registryProviderId);

  const escrowContract = new Contract(escrow, ESCROW_ABI, wallet);
  const paymentTokenAddress = getAddress(String(await escrowContract.paymentToken()));
  const paymentToken = new Contract(paymentTokenAddress, ERC20_ABI, wallet);
  const allowance = (await paymentToken.allowance(expectedUser, escrow)) as bigint;

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
