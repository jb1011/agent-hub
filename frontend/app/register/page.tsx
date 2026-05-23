"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Zap, ExternalLink } from "lucide-react";
import { useAccount, useSendTransaction } from "wagmi";
import { arcTestnet } from "viem/chains";
import type { CreateProviderInput } from "skillhub-sdk";
import { ensureArcTestnet } from "../lib/arc-wallet";
import { useWalletChainId } from "../lib/useWalletChainId";
import { skillHub } from "../lib/skillhub";
import {
  DEFAULT_PROVIDER_TIMEOUT_SECONDS,
  PLAIN_TEXT_INPUT_SCHEMA,
  PLAIN_TEXT_OUTPUT_SCHEMA,
} from "../lib/provider-defaults";
import NavMenu from "../components/NavMenu";
import { ConnectButton } from "../components/ConnectButton";

const GRID = "rgba(0,0,0,0.12)";

type Status = "idle" | "switching" | "signing" | "success" | "error";

const inputClass =
  "w-full bg-transparent border border-black/15 px-4 py-3 text-sm placeholder:text-black/30 focus:outline-none focus:border-[#E85A00] transition-colors resize-none";

const inputClassMono =
  "w-full bg-transparent border border-black/15 px-4 py-3 text-sm font-mono placeholder:text-black/30 focus:outline-none focus:border-[#E85A00] transition-colors";

function formatSubmitError(err: unknown): string {
  const raw = err instanceof Error ? err.message : "Something went wrong";
  if (
    raw.includes("request_id_already_exists") ||
    raw.includes("P2002") ||
    raw.includes("Unique constraint failed")
  ) {
    return "Registration conflict — try again or contact support.";
  }
  if (
    raw.includes("does not match the target chain") ||
    raw.includes("Expected Chain ID: 5042002")
  ) {
    return "MetaMask is on the wrong network. Click Register again and approve the Arc Testnet switch in MetaMask.";
  }
  if ((err as { code?: number })?.code === 4001) {
    return "You rejected the MetaMask prompt. Approve the network switch or transaction to continue.";
  }
  return raw;
}

export default function RegisterPage() {
  const { address, isConnected } = useAccount();
  const walletChainId = useWalletChainId();
  const onArc = walletChainId === arcTestnet.id;

  const { sendTransactionAsync } = useSendTransaction();

  const [form, setForm] = useState({
    name: "",
    description: "",
    api_base_url: "",
    service_type: "text_generation",
    price_usdc: "1",
    max_concurrent_jobs: "2",
    samePayoutWallet: true,
    payout_wallet: "",
  });
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [registeredRequestId, setRegisteredRequestId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (address) {
      setForm((f) => ({
        ...f,
        ...(f.samePayoutWallet ? { payout_wallet: address } : {}),
      }));
    }
  }, [address, form.samePayoutWallet]);

  function set<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const price = Number.parseFloat(form.price_usdc);
  const maxJobs = Number.parseInt(form.max_concurrent_jobs, 10);

  const requiredFilled =
    form.name.trim() !== "" &&
    form.api_base_url.trim() !== "" &&
    form.service_type.trim() !== "" &&
    Number.isFinite(price) &&
    price > 0 &&
    Number.isInteger(maxJobs) &&
    maxJobs > 0 &&
    (form.samePayoutWallet || form.payout_wallet.trim() !== "");

  const isSubmitting = status === "switching" || status === "signing";
  const canSubmit = requiredFilled && isConnected && !!address && !isSubmitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !address) return;

    setErrorMsg("");
    setTxHash(null);
    setRegisteredRequestId(null);

    try {
      const payload: CreateProviderInput = {
        name: form.name.trim(),
        ...(form.description.trim()
          ? { description: form.description.trim() }
          : {}),
        owner_wallet: address,
        signer_wallet: address,
        payout_wallet: form.samePayoutWallet
          ? address
          : form.payout_wallet.trim(),
        api_base_url: form.api_base_url.trim(),
        service_type: form.service_type.trim(),
        input_schema: PLAIN_TEXT_INPUT_SCHEMA,
        output_schema: PLAIN_TEXT_OUTPUT_SCHEMA,
        price_usdc: price,
        max_concurrent_jobs: maxJobs,
        timeout_seconds: DEFAULT_PROVIDER_TIMEOUT_SECONDS,
      };

      setStatus("signing");
      const { request_id, transaction } = await skillHub.providers.create(payload);
      setRegisteredRequestId(request_id);

      if (
        transaction.chain_id !== undefined &&
        transaction.chain_id !== arcTestnet.id
      ) {
        throw new Error(
          `Prepared transaction targets chain ${transaction.chain_id}, expected Arc Testnet (${arcTestnet.id}).`,
        );
      }

      setStatus("switching");
      await ensureArcTestnet();

      setStatus("signing");
      const hash = await sendTransactionAsync({
        to: transaction.to as `0x${string}`,
        data: transaction.data as `0x${string}`,
        value: BigInt(transaction.value),
        chainId: arcTestnet.id,
      });

      setTxHash(hash);
      setStatus("success");
    } catch (err) {
      setErrorMsg(formatSubmitError(err));
      setStatus("error");
    }
  }

  return (
    <div
      className="min-h-screen w-full overflow-x-hidden"
      style={{
        background: "#E8E8E4",
        fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
        borderLeft: `1px solid ${GRID}`,
        borderRight: `1px solid ${GRID}`,
      }}
    >
      <NavMenu />

      <div
        className="flex items-center gap-3 px-6 md:px-10 py-4"
        style={{ borderBottom: `1px solid ${GRID}` }}
      >
        <div className="w-2 h-2" style={{ background: "#E85A00" }} />
        <span className="text-xs font-semibold tracking-widest uppercase text-black/50">
          Register Provider
        </span>
      </div>

      <div
        className="flex flex-col md:flex-row"
        style={{ minHeight: "calc(100vh - 112px)" }}
      >
        <div
          className="md:w-[38%] shrink-0 px-6 md:px-10 py-12 md:py-16 flex flex-col justify-between"
          style={{ borderRight: `1px solid ${GRID}` }}
        >
          <div>
            <h1
              className="uppercase mb-5 leading-none text-black"
              style={{
                fontFamily: "var(--font-bebas-neue), sans-serif",
                fontSize: "clamp(48px, 7vw, 96px)",
                lineHeight: 0.92,
                letterSpacing: "-0.01em",
              }}
            >
              Register
              <br />
              Your
              <br />
              Provider
            </h1>
            <p className="text-sm text-black/60 leading-relaxed max-w-xs mb-8">
              Register your agent as a provider with pricing and API details.
              The API assigns a <span className="font-mono">request_id</span>;
              you sign the on-chain registration on Arc Testnet.
            </p>
            <div className="flex items-center gap-2">
              <div
                className="w-5 h-5 flex items-center justify-center"
                style={{ background: "#E85A00" }}
              >
                <Zap size={10} className="text-white fill-white" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-black/40">
                AgentHub · Arc Testnet
              </span>
            </div>
          </div>

          <p className="mt-10 text-[10px] text-black/30 uppercase tracking-widest leading-relaxed">
            Input/output schemas are fixed to plain text.{" "}
            <span className="text-black/60">owner_wallet</span> and{" "}
            <span className="text-black/60">signer_wallet</span> default to
            your connected address.
          </p>
        </div>

        <div className="flex-1 px-6 md:px-10 py-12 md:py-16">
          {status === "success" ? (
            <div className="flex flex-col items-start gap-6 max-w-lg">
              <div
                className="w-12 h-12 flex items-center justify-center text-white text-xl"
                style={{ background: "#E85A00" }}
              >
                ✓
              </div>
              <h2
                className="uppercase"
                style={{
                  fontFamily: "var(--font-bebas-neue), sans-serif",
                  fontSize: "clamp(32px, 4vw, 52px)",
                  lineHeight: 1,
                  color: "#0c0c0c",
                }}
              >
                Provider Registered
              </h2>
              <p className="text-sm text-black/60 leading-relaxed">
                {txHash
                  ? "Your registration transaction was broadcast to Arc Testnet. Once confirmed, your provider appears in the directory."
                  : "Provider record was created in the API."}
              </p>
              {registeredRequestId && (
                <p className="text-[11px] font-mono text-black/50 break-all">
                  request_id: {registeredRequestId}
                </p>
              )}
              {txHash && (
                <a
                  href={`https://testnet.arcscan.app/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-[#E85A00] hover:underline flex items-center gap-1 break-all"
                >
                  {txHash}
                  <ExternalLink size={12} />
                </a>
              )}
              <div className="flex gap-3">
                <a href="/agents" className="btn-cyber">
                  View Providers <ArrowRight size={13} />
                </a>
                <a href="/" className="btn-cyber">
                  Back to Home
                </a>
              </div>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-8 max-w-2xl"
            >
              <div>
                <div className="text-[10px] uppercase tracking-widest font-bold text-black/40 mb-4">
                  Wallet
                </div>
                <ConnectButton signInRequired={false} />
                {!isConnected && (
                  <p className="text-[11px] text-black/40 mt-3">
                    Connect MetaMask — used as{" "}
                    <span className="font-mono">owner_wallet</span> and{" "}
                    <span className="font-mono">signer_wallet</span>.
                  </p>
                )}
                {isConnected && walletChainId !== null && !onArc && (
                  <p className="text-[11px] text-[#E85A00] font-medium mt-3">
                    MetaMask is on chain {walletChainId}. Submit will prompt Arc
                    Testnet.
                  </p>
                )}
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-widest font-bold text-black/40 mb-4">
                  Provider
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                      Name <span className="text-[#E85A00]">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Demo Provider"
                      value={form.name}
                      onChange={(e) => set("name", e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                      Description
                    </label>
                    <textarea
                      rows={2}
                      placeholder="What your agent does…"
                      value={form.description}
                      onChange={(e) => set("description", e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                      API Base URL <span className="text-[#E85A00]">*</span>
                    </label>
                    <input
                      type="url"
                      required
                      placeholder="http://164.68.116.179:3000 (agent base; UI calls /chat)"
                      value={form.api_base_url}
                      onChange={(e) => set("api_base_url", e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-widest font-bold text-black/40 mb-4">
                  Service
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                      Service Type <span className="text-[#E85A00]">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="text_generation"
                      value={form.service_type}
                      onChange={(e) => set("service_type", e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                      Price (USDC) <span className="text-[#E85A00]">*</span>
                    </label>
                    <input
                      type="number"
                      required
                      min="0.000001"
                      step="0.000001"
                      placeholder="1"
                      value={form.price_usdc}
                      onChange={(e) => set("price_usdc", e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                      Max Concurrent Jobs{" "}
                      <span className="text-[#E85A00]">*</span>
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      step="1"
                      placeholder="2"
                      value={form.max_concurrent_jobs}
                      onChange={(e) =>
                        set("max_concurrent_jobs", e.target.value)
                      }
                      className={inputClass}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 justify-end">
                    <span className="text-[10px] text-black/35 leading-relaxed">
                      Timeout: {DEFAULT_PROVIDER_TIMEOUT_SECONDS}s (fixed)
                      <br />
                      Schemas: plain text in / out (fixed)
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                  Payout Wallet <span className="text-[#E85A00]">*</span>
                </label>
                <label className="flex items-center gap-2 text-[11px] text-black/60 select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.samePayoutWallet}
                    onChange={(e) => set("samePayoutWallet", e.target.checked)}
                    className="accent-[#E85A00]"
                  />
                  Use connected wallet as payout wallet
                </label>
                <input
                  type="text"
                  required
                  placeholder="0x…"
                  disabled={form.samePayoutWallet}
                  value={
                    form.samePayoutWallet ? (address ?? "") : form.payout_wallet
                  }
                  onChange={(e) => set("payout_wallet", e.target.value)}
                  className={`${inputClassMono} disabled:opacity-60`}
                />
              </div>

              {status === "error" && (
                <div
                  className="p-3 text-xs text-red-700 break-words"
                  style={{
                    border: "1px solid rgba(220, 38, 38, 0.3)",
                    background: "rgba(220, 38, 38, 0.05)",
                  }}
                >
                  {errorMsg}
                </div>
              )}

              <div className="flex items-center gap-4">
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="btn-cyber disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {status === "switching"
                    ? "Switching Network…"
                    : status === "signing"
                      ? "Awaiting Signature…"
                      : "Register Provider"}
                  {!isSubmitting && <ArrowRight size={13} />}
                </button>
                {!isConnected && (
                  <span className="text-[11px] text-black/40">
                    Connect a wallet to enable submission.
                  </span>
                )}
              </div>
            </form>
          )}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${GRID}` }} />
    </div>
  );
}
