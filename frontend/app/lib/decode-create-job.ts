import { decodeFunctionData } from "viem";

const createJobAbi = [
  {
    type: "function",
    name: "createJob",
    inputs: [
      { name: "providerId", type: "uint256" },
      { name: "requestId", type: "bytes32" },
      { name: "inputCommitment", type: "bytes32" },
      { name: "queueTimeoutSeconds", type: "uint64" },
      { name: "expiresAt", type: "uint256" },
      { name: "deliveryAttesterSignature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

/** Extract the job `request_id` (bytes32) encoded in a prepared createJob transaction. */
export function decodeCreateJobRequestId(data: string): string {
  const decoded = decodeFunctionData({
    abi: createJobAbi,
    data: data as `0x${string}`,
  });
  return decoded.args[1] as string;
}
