import { createPublicClient, http } from "viem";
import { arcTestnet } from "viem/chains";

export const arcPublicClient = createPublicClient({
  chain: arcTestnet,
  transport: http("https://rpc.testnet.arc.network"),
});
