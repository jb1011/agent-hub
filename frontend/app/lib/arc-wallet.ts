import { arcTestnet } from "viem/chains";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: () => void) => void;
  removeListener?: (event: string, handler: () => void) => void;
};

export function getEthereum(): EthereumProvider | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { ethereum?: EthereumProvider }).ethereum;
}

/** Reads the chain MetaMask (or injected wallet) is actually on — not wagmi's cached state. */
export async function getWalletChainId(): Promise<number | null> {
  const ethereum = getEthereum();
  if (!ethereum) return null;
  const hex = await ethereum.request({ method: "eth_chainId" });
  return Number.parseInt(String(hex), 16);
}

/**
 * Prompts MetaMask to add and/or switch to Arc Testnet.
 * Always talks to window.ethereum directly so the prompt fires even when
 * wagmi thinks the wallet is already on Arc.
 */
export async function ensureArcTestnet(): Promise<void> {
  const ethereum = getEthereum();
  if (!ethereum) {
    throw new Error("No wallet found. Connect MetaMask first.");
  }

  const current = await getWalletChainId();
  if (current === arcTestnet.id) return;

  const chainIdHex = `0x${arcTestnet.id.toString(16)}`;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (err) {
    const code = (err as { code?: number })?.code;
    // 4902 = chain not added to MetaMask yet
    if (code !== 4902) throw err;

    const explorer = arcTestnet.blockExplorers?.default?.url;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex,
          chainName: arcTestnet.name,
          nativeCurrency: arcTestnet.nativeCurrency,
          rpcUrls: [...arcTestnet.rpcUrls.default.http],
          ...(explorer ? { blockExplorerUrls: [explorer] } : {}),
        },
      ],
    });
  }

  const after = await getWalletChainId();
  if (after !== arcTestnet.id) {
    throw new Error(
      "Wallet is still not on Arc Testnet. Open MetaMask and select Arc Testnet, then try again.",
    );
  }
}
