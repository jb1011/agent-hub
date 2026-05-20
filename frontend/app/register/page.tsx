"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Zap, ExternalLink } from "lucide-react";
import { useAccount, useChainId, useSendTransaction } from "wagmi";
import { arcTestnet } from "viem/chains";
import {
  SkillHubClient,
  type CreateProviderInput,
  type PreparedContractTransaction,
} from "skillhub-sdk";
import NavMenu from "../components/NavMenu";
import { ConnectButton } from "../components/ConnectButton";

const GRID = "rgba(0,0,0,0.12)";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

const sdk = new SkillHubClient({ baseUrl: API_BASE_URL });

type Status = "idle" | "loading" | "success" | "error";

const inputClass =
  "w-full bg-transparent border border-black/15 px-4 py-3 text-sm placeholder:text-black/30 focus:outline-none focus:border-[#E85A00] transition-colors resize-none";

const inputClassMono =
  "w-full bg-transparent border border-black/15 px-4 py-3 text-sm font-mono placeholder:text-black/30 focus:outline-none focus:border-[#E85A00] transition-colors";

function isPreparedTransaction(
  value: unknown,
): value is PreparedContractTransaction {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.to === "string" &&
    typeof candidate.data === "string" &&
    typeof candidate.value === "string"
  );
}

export default function RegisterPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const onArc = chainId === arcTestnet.id;

  const { sendTransactionAsync } = useSendTransaction();

  const [form, setForm] = useState({
    provider_id: "",
    name: "",
    description: "",
    api_base_url: "",
    payout_wallet: "",
    samePayoutWallet: true,
  });
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);

  useEffect(() => {
    if (form.samePayoutWallet && address) {
      setForm((f) => ({ ...f, payout_wallet: address }));
    }
  }, [address, form.samePayoutWallet]);

  function set<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const requiredFilled =
    form.provider_id.trim() !== "" &&
    form.name.trim() !== "" &&
    form.api_base_url.trim() !== "" &&
    (form.samePayoutWallet || form.payout_wallet.trim() !== "");

  const canSubmit = requiredFilled && isConnected && onArc && !!address;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !address) return;

    setStatus("loading");
    setErrorMsg("");
    setTxHash(null);

    try {
      const payload: CreateProviderInput = {
        provider_id: form.provider_id.trim(),
        name: form.name.trim(),
        ...(form.description.trim()
          ? { description: form.description.trim() }
          : {}),
        owner_wallet: address,
        payout_wallet: form.samePayoutWallet
          ? address
          : form.payout_wallet.trim(),
        api_base_url: form.api_base_url.trim(),
      };

      const response = (await sdk.providers.create(payload)) as
        | PreparedContractTransaction
        | Record<string, unknown>;

      if (!isPreparedTransaction(response)) {
        // Legacy API path: backend already persisted the provider and did not
        // return a prepared on-chain transaction. Treat as success without a
        // signature step.
        setTxHash(null);
        setStatus("success");
        return;
      }

      if (
        response.chain_id !== undefined &&
        response.chain_id !== arcTestnet.id
      ) {
        throw new Error(
          `Prepared transaction targets chain ${response.chain_id}, expected Arc Testnet (${arcTestnet.id}).`,
        );
      }

      const hash = await sendTransactionAsync({
        to: response.to as `0x${string}`,
        data: response.data as `0x${string}`,
        value: BigInt(response.value),
        chainId: arcTestnet.id,
      });

      setTxHash(hash);
      setStatus("success");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong";
      setErrorMsg(message);
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

      {/* Page header */}
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
        {/* Left: intro */}
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
              Register as a provider on Agent Hub to list services and earn
              USDC on Arc. Submission requires a signed transaction from your
              connected wallet on the Arc Testnet.
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
            Fields marked with <span className="text-[#E85A00]">*</span> are
            required. Your <span className="text-black/60">owner_wallet</span>{" "}
            will be the connected MetaMask address.
          </p>
        </div>

        {/* Right: form */}
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
                  ? "Your registration transaction was broadcast to Arc Testnet. Once confirmed, your provider will appear in the directory."
                  : "Your provider was registered. The API skipped the on-chain step, so no transaction hash was produced."}
              </p>
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
                  View Agents <ArrowRight size={13} />
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
              {/* Wallet block */}
              <div>
                <div className="text-[10px] uppercase tracking-widest font-bold text-black/40 mb-4">
                  Wallet
                </div>
                <ConnectButton />
                {!isConnected && (
                  <p className="text-[11px] text-black/40 mt-3">
                    Connect MetaMask to populate your{" "}
                    <span className="font-mono">owner_wallet</span> and sign
                    the registration transaction.
                  </p>
                )}
                {isConnected && !onArc && (
                  <p className="text-[11px] text-[#E85A00] font-medium mt-3">
                    Wrong network. Switch to Arc Testnet (chain id{" "}
                    {arcTestnet.id}) to continue.
                  </p>
                )}
              </div>

              {/* Provider id + name */}
              <div>
                <div className="text-[10px] uppercase tracking-widest font-bold text-black/40 mb-4">
                  Provider Identity
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                      Provider ID <span className="text-[#E85A00]">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      inputMode="numeric"
                      pattern="[0-9]+"
                      placeholder="e.g. 1"
                      value={form.provider_id}
                      onChange={(e) => set("provider_id", e.target.value)}
                      className={inputClassMono}
                    />
                    <span className="text-[10px] text-black/35">
                      uint256 decimal string — unique numeric id you choose.
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                      Name <span className="text-[#E85A00]">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="My Agent"
                      value={form.name}
                      onChange={(e) => set("name", e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>

              {/* Description */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                  Description
                </label>
                <textarea
                  rows={3}
                  placeholder="A short description of what your agent does…"
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  className={inputClass}
                />
              </div>

              {/* API base url */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                  API Base URL <span className="text-[#E85A00]">*</span>
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://your-agent-api.example.com"
                  value={form.api_base_url}
                  onChange={(e) => set("api_base_url", e.target.value)}
                  className={inputClass}
                />
                <span className="text-[10px] text-black/35">
                  Base URL of your agent&apos;s API — services append their
                  endpoint path to this.
                </span>
              </div>

              {/* Payout wallet */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                  Payout Wallet <span className="text-[#E85A00]">*</span>
                </label>
                <label className="flex items-center gap-2 text-[11px] text-black/60 select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.samePayoutWallet}
                    onChange={(e) =>
                      set("samePayoutWallet", e.target.checked)
                    }
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
                    form.samePayoutWallet
                      ? address ?? ""
                      : form.payout_wallet
                  }
                  onChange={(e) => set("payout_wallet", e.target.value)}
                  className={`${inputClassMono} disabled:opacity-60`}
                />
                <span className="text-[10px] text-black/35">
                  Arc wallet that receives USDC payouts for completed jobs.
                </span>
              </div>

              {/* Error */}
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

              {/* Submit */}
              <div className="flex items-center gap-4">
                <button
                  type="submit"
                  disabled={!canSubmit || status === "loading"}
                  className="btn-cyber disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {status === "loading"
                    ? "Awaiting Signature…"
                    : "Register Provider"}
                  {status !== "loading" && <ArrowRight size={13} />}
                </button>
                {!isConnected && (
                  <span className="text-[11px] text-black/40">
                    Connect a wallet to enable submission.
                  </span>
                )}
                {isConnected && !onArc && (
                  <span className="text-[11px] text-black/40">
                    Switch to Arc Testnet to enable submission.
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
