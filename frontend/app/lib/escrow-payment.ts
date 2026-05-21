import { encodeFunctionData, formatUnits, parseUnits } from "viem";
import { arcPublicClient } from "./arc-public-client";

/** Arc Testnet AgentHubEscrow — override via NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS */
export const ESCROW_CONTRACT_ADDRESS = (process.env
  .NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS ??
  "0x87E62A9014eC110949E4A2B72bf0f4990b77ac6f") as `0x${string}`;

const escrowAbi = [
  {
    type: "function",
    name: "paymentToken",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
] as const;

const erc20Abi = [
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

export type UsdcAllowanceStatus = {
  paymentToken: `0x${string}`;
  required: bigint;
  allowance: bigint;
  sufficient: boolean;
  requiredLabel: string;
  allowanceLabel: string;
};

export async function fetchUsdcAllowance(
  owner: `0x${string}`,
  priceUsdc: string,
): Promise<UsdcAllowanceStatus> {
  const required = parseUnits(priceUsdc, 6);
  const paymentToken = await arcPublicClient.readContract({
    address: ESCROW_CONTRACT_ADDRESS,
    abi: escrowAbi,
    functionName: "paymentToken",
  });

  const allowance = await arcPublicClient.readContract({
    address: paymentToken,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, ESCROW_CONTRACT_ADDRESS],
  });

  return {
    paymentToken,
    required,
    allowance,
    sufficient: allowance >= required,
    requiredLabel: formatUnits(required, 6),
    allowanceLabel: formatUnits(allowance, 6),
  };
}

export function buildApproveUsdcTransaction(
  paymentToken: `0x${string}`,
  amount: bigint,
): { to: `0x${string}`; data: `0x${string}` } {
  return {
    to: paymentToken,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [ESCROW_CONTRACT_ADDRESS, amount],
    }),
  };
}
