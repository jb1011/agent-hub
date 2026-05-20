"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { arcTestnet } from "viem/chains";
import { Wallet, Check, AlertTriangle, LogOut } from "lucide-react";
import { ensureArcTestnet } from "../lib/arc-wallet";
import { useWalletChainId } from "../lib/useWalletChainId";

function shortenAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const walletChainId = useWalletChainId();
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const onArc = walletChainId === arcTestnet.id;

  async function handleSwitchToArc() {
    setSwitchError(null);
    setIsSwitching(true);
    try {
      await ensureArcTestnet();
    } catch (err) {
      setSwitchError(err instanceof Error ? err.message : "Failed to switch network");
    } finally {
      setIsSwitching(false);
    }
  }

  const metaMask =
    connectors.find((c) => c.id === "metaMask") ??
    connectors.find((c) => c.id === "injected") ??
    connectors[0];

  if (!isConnected) {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => metaMask && connect({ connector: metaMask })}
          disabled={isPending || !metaMask}
          className="btn-cyber disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Wallet size={13} />
          {isPending ? "Connecting…" : "Connect MetaMask"}
        </button>
        {connectError && (
          <span className="text-[11px] text-red-600 font-medium">
            {connectError.message}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="flex items-center gap-2 px-3 py-2 text-xs font-mono"
          style={{
            border: "1px solid rgba(0,0,0,0.15)",
            background: "rgba(255,255,255,0.4)",
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: onArc ? "#22c55e" : "#E85A00" }}
          />
          {address ? shortenAddress(address) : "—"}
        </div>

        {walletChainId === null ? (
          <span className="text-[10px] uppercase tracking-widest text-black/40">
            Reading network…
          </span>
        ) : onArc ? (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-1"
            style={{ background: "#0C0C0C", color: "#fff" }}
          >
            <Check size={10} />
            Arc Testnet
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void handleSwitchToArc()}
            disabled={isSwitching}
            className="btn-cyber disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <AlertTriangle size={13} />
            {isSwitching ? "Switching…" : "Switch to Arc Testnet"}
          </button>
        )}

        <button
          type="button"
          onClick={() => disconnect()}
          className="text-[10px] uppercase tracking-widest text-black/40 hover:text-black flex items-center gap-1"
        >
          <LogOut size={11} />
          Disconnect
        </button>
      </div>
      {switchError && (
        <span className="text-[11px] text-red-600 font-medium">
          {switchError}
        </span>
      )}
    </div>
  );
}
