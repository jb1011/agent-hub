"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Zap, ExternalLink } from "lucide-react";
import { useAccount, useSendTransaction } from "wagmi";
import { arcTestnet } from "viem/chains";
import {
  SkillHubClient,
  type PreparedContractTransaction,
} from "skillhub-sdk";
import NavMenu from "../../components/NavMenu";
import { ConnectButton } from "../../components/ConnectButton";
import { ensureArcTestnet } from "../../lib/arc-wallet";
import { useWalletChainId } from "../../lib/useWalletChainId";
import { sha256Bytes32Hex } from "../../lib/sha256";
import { apiKeys, fetchProvider } from "../../lib/api";

const GRID = "rgba(0,0,0,0.12)";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

const QUEUE_TIMEOUT_SECONDS = 300;
const AUTHORIZATION_EXPIRES_IN_SECONDS = 999_999_999;

const sdk = new SkillHubClient({ baseUrl: API_BASE_URL });

type Status = "idle" | "switching" | "signing" | "success" | "error";

const inputClass =
  "w-full bg-transparent border border-black/15 px-4 py-3 text-sm placeholder:text-black/30 focus:outline-none focus:border-[#E85A00] transition-colors resize-none";

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

function formatSubmitError(err: unknown): string {
  const raw = err instanceof Error ? err.message : "Something went wrong";
  if (raw.includes("service_not_found")) {
    return "No service exists for this provider ID. The provider must list a service with the same ID before you can create a job.";
  }
  if (
    raw.includes("does not match the target chain") ||
    raw.includes("Expected Chain ID: 5042002")
  ) {
    return "MetaMask is on the wrong network. Submit again and approve the Arc Testnet switch in MetaMask.";
  }
  if ((err as { code?: number })?.code === 4001) {
    return "You rejected the MetaMask prompt. Approve the network switch or transaction to continue.";
  }
  return raw;
}

export default function CreateJobPage() {
  const params = useParams();
  const providerId = decodeURIComponent(String(params.providerId ?? ""));

  const { address, isConnected } = useAccount();
  const walletChainId = useWalletChainId();
  const onArc = walletChainId === arcTestnet.id;
  const { sendTransactionAsync } = useSendTransaction();

  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);

  const {
    data: provider,
    isLoading: loadingProvider,
    isError: providerError,
  } = useQuery({
    queryKey: apiKeys.provider(providerId),
    queryFn: () => fetchProvider(providerId),
    enabled: providerId.length > 0,
  });

  const isSubmitting = status === "switching" || status === "signing";
  const canSubmit =
    question.trim().length > 0 &&
    isConnected &&
    !!address &&
    !isSubmitting &&
    !loadingProvider &&
    !providerError;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !address) return;

    setErrorMsg("");
    setTxHash(null);

    try {
      const trimmed = question.trim();
      const inputHash = await sha256Bytes32Hex(trimmed);

      setStatus("signing");
      const response = await sdk.jobs.create({
        user_wallet: address,
        service_id: providerId,
        input: { uri: trimmed },
        input_hash: inputHash,
        queue_timeout_seconds: QUEUE_TIMEOUT_SECONDS,
        authorization_expires_in_seconds: AUTHORIZATION_EXPIRES_IN_SECONDS,
      });

      if (!isPreparedTransaction(response)) {
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

      setStatus("switching");
      await ensureArcTestnet();

      setStatus("signing");
      const hash = await sendTransactionAsync({
        to: response.to as `0x${string}`,
        data: response.data as `0x${string}`,
        value: BigInt(response.value),
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
          Create Job
        </span>
        {provider && (
          <>
            <span className="text-black/20">·</span>
            <span className="text-xs font-medium text-black/50 truncate">
              {provider.name}
            </span>
          </>
        )}
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
            {loadingProvider ? (
              <p className="text-sm text-black/40">Loading provider…</p>
            ) : providerError || !provider ? (
              <p className="text-sm text-red-600">
                Provider &quot;{providerId}&quot; not found.
              </p>
            ) : (
              <>
                <h1
                  className="uppercase mb-5 leading-none text-black"
                  style={{
                    fontFamily: "var(--font-bebas-neue), sans-serif",
                    fontSize: "clamp(48px, 7vw, 96px)",
                    lineHeight: 0.92,
                    letterSpacing: "-0.01em",
                  }}
                >
                  Ask
                  <br />
                  {provider.name}
                </h1>
                <p className="text-sm text-black/60 leading-relaxed max-w-xs mb-4">
                  Submit a question to this provider. Your input is committed
                  on-chain with SHA-256, then funded via USDC escrow on Arc
                  Testnet.
                </p>
                <div className="text-[10px] uppercase tracking-widest text-black/35 space-y-1">
                  <div>Provider ID: {provider.provider_id}</div>
                  <div>Service ID: {providerId}</div>
                </div>
              </>
            )}
            <div className="flex items-center gap-2 mt-8">
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

          <div className="mt-10 flex flex-col gap-3">
            <a href="/agents" className="btn-cyber w-fit">
              ← All Providers
            </a>
            <p className="text-[10px] text-black/30 uppercase tracking-widest leading-relaxed">
              Connect MetaMask on Arc Testnet. You need testnet USDC for gas and
              escrow payment.
            </p>
          </div>
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
                Job Created
              </h2>
              <p className="text-sm text-black/60 leading-relaxed">
                {txHash
                  ? "Your create-job transaction was broadcast to Arc Testnet. Once confirmed, the job is funded on-chain."
                  : "Job was created in the API without an on-chain transaction step."}
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
              <a href="/agents" className="btn-cyber">
                Back to Providers <ArrowRight size={13} />
              </a>
            </div>
          ) : providerError || (!loadingProvider && !provider) ? (
            <div className="max-w-lg">
              <p className="text-sm text-black/60 mb-6">
                Cannot create a job for an unknown provider.
              </p>
              <a href="/agents" className="btn-cyber">
                Browse Providers <ArrowRight size={13} />
              </a>
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
                <ConnectButton />
                {isConnected && walletChainId !== null && !onArc && (
                  <p className="text-[11px] text-[#E85A00] font-medium mt-3">
                    MetaMask is on chain {walletChainId}. Submit will prompt you
                    to switch to Arc Testnet.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                  Your question <span className="text-[#E85A00]">*</span>
                </label>
                <textarea
                  required
                  rows={5}
                  placeholder="What do you want this agent to do?"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  className={inputClass}
                  disabled={loadingProvider}
                />
                <span className="text-[10px] text-black/35">
                  Stored as <span className="font-mono">input.uri</span>.{" "}
                  <span className="font-mono">input_hash</span> is SHA-256 of
                  this text (bytes32).
                </span>
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
                      : "Create Job"}
                  {!isSubmitting && <ArrowRight size={13} />}
                </button>
                {!isConnected && (
                  <span className="text-[11px] text-black/40">
                    Connect a wallet to submit.
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
