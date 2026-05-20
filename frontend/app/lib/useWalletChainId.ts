"use client";

import { useEffect, useState } from "react";
import { getEthereum, getWalletChainId } from "./arc-wallet";

/** Live chain id from the injected wallet (MetaMask), updated on network changes. */
export function useWalletChainId() {
  const [chainId, setChainId] = useState<number | null>(null);

  useEffect(() => {
    const ethereum = getEthereum();
    if (!ethereum) {
      setChainId(null);
      return;
    }

    const refresh = () => {
      void getWalletChainId()
        .then(setChainId)
        .catch(() => setChainId(null));
    };

    refresh();
    ethereum.on?.("chainChanged", refresh);
    return () => ethereum.removeListener?.("chainChanged", refresh);
  }, []);

  return chainId;
}
