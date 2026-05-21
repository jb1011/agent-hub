"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Zap, ExternalLink, Loader2 } from "lucide-react";
import { useAccount, useSendTransaction } from "wagmi";
import { arcTestnet } from "viem/chains";
import type { CreateJobInput, JobWithDetails } from "skillhub-sdk";
import NavMenu from "../../components/NavMenu";
import { ConnectButton } from "../../components/ConnectButton";
import { ensureArcTestnet } from "../../lib/arc-wallet";
import { arcPublicClient } from "../../lib/arc-public-client";
import { useWalletChainId } from "../../lib/useWalletChainId";
import { decodeCreateJobRequestId } from "../../lib/decode-create-job";
import { formatJobOutput } from "../../lib/format-job-output";
import { sha256Bytes32Hex } from "../../lib/sha256";
import {
  buildApproveUsdcTransaction,
  fetchUsdcAllowance,
} from "../../lib/escrow-payment";
import { serverApiBaseUrl, skillHub } from "../../lib/skillhub";
import { apiKeys, fetchProvider } from "../../lib/api";

const SKILLHUB_API_URL = serverApiBaseUrl;

const GRID = "rgba(0,0,0,0.12)";

const QUEUE_TIMEOUT_SECONDS = 300;
const AUTHORIZATION_EXPIRES_IN_SECONDS = 999_999_999;

const TERMINAL_FAILURE_STATUSES = new Set(["FAILED", "EXPIRED", "REFUNDED"]);

type Phase =
  | "form"
  | "switching"
  | "signing"
  | "confirming"
  | "waiting_funded"
  | "waiting_output"
  | "done"
  | "error";

const inputClass =
  "w-full bg-transparent border border-black/15 px-4 py-3 text-sm placeholder:text-black/30 focus:outline-none focus:border-[#E85A00] transition-colors resize-none";

function formatSubmitError(err: unknown): string {
  const raw = err instanceof Error ? err.message : "Something went wrong";
  if (raw.includes("provider_not_found")) {
    return "Provider not found.";
  }
  if (raw.includes("provider_registry_id_missing")) {
    return "This provider is not on-chain yet. Finish registration and wait for confirmation before creating a job.";
  }
  if (raw.includes("insufficient allowance") || raw.includes("ERC20")) {
    return "USDC allowance may be insufficient. Approve USDC for the escrow contract on Arc Testnet, then try again.";
  }
  if (
    raw.includes("does not match the target chain") ||
    raw.includes("Expected Chain ID: 5042002")
  ) {
    return "MetaMask is on the wrong network. Submit again and approve the Arc Testnet switch.";
  }
  if ((err as { code?: number })?.code === 4001) {
    return "You rejected the MetaMask prompt.";
  }
  return raw;
}

function LoadingPanel({
  title,
  detail,
  job,
}: {
  title: string;
  detail: string;
  job?: JobWithDetails;
}) {
  return (
    <div className="flex flex-col items-start gap-6 max-w-lg">
      <Loader2
        size={40}
        className="text-[#E85A00] animate-spin"
        style={{ animationDuration: "1.2s" }}
      />
      <h2
        className="uppercase"
        style={{
          fontFamily: "var(--font-bebas-neue), sans-serif",
          fontSize: "clamp(32px, 4vw, 52px)",
          lineHeight: 1,
          color: "#0c0c0c",
        }}
      >
        {title}
      </h2>
      <p className="text-sm text-black/60 leading-relaxed">{detail}</p>
      {job && (
        <div className="text-[10px] uppercase tracking-widest text-black/35 space-y-1 font-mono">
          <div className="break-all">request_id: {job.request_id}</div>
          {job.job_id && <div>job_id: {job.job_id}</div>}
          <div>status: {job.status}</div>
        </div>
      )}
    </div>
  );
}

export default function CreateJobPage() {
  const params = useParams();
  /** Provider page id in the URL — provider `request_id` (bytes32). */
  const providerRequestId = decodeURIComponent(String(params.providerId ?? ""));

  const queryClient = useQueryClient();
  const { address, isConnected } = useAccount();
  const walletChainId = useWalletChainId();
  const onArc = walletChainId === arcTestnet.id;
  const { sendTransactionAsync } = useSendTransaction();

  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [approveBusy, setApproveBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [approveTxHash, setApproveTxHash] = useState<string | null>(null);
  const [jobRequestId, setJobRequestId] = useState<string | null>(null);
  const [invokeError, setInvokeError] = useState<string | null>(null);
  const invokedForJobRef = useRef<string | null>(null);

  const {
    data: provider,
    isLoading: loadingProvider,
    isError: providerError,
  } = useQuery({
    queryKey: apiKeys.provider(providerRequestId),
    queryFn: () => fetchProvider(providerRequestId),
    enabled: providerRequestId.length > 0,
  });
  const {
    data: allowance,
    isLoading: loadingAllowance,
    isFetching: fetchingAllowance,
    isError: allowanceError,
  } = useQuery({
    queryKey: [
      "usdc-allowance",
      address,
      provider?.price_usdc,
      provider?.registry_provider_id,
    ],
    queryFn: () => fetchUsdcAllowance(address!, provider!.price_usdc),
    enabled:
      isConnected &&
      !!address &&
      !!provider?.price_usdc &&
      !!provider?.registry_provider_id,
  });

  const hasSufficientAllowance = allowance?.sufficient === true;
  const needsApproval = Boolean(allowance && !allowance.sufficient);

  const isTxBusy =
    phase === "switching" || phase === "signing" || phase === "confirming";
  const isPolling = phase === "waiting_funded" || phase === "waiting_output";

  const canApprove =
    isConnected &&
    !!address &&
    !approveBusy &&
    !isTxBusy &&
    !isPolling &&
    !loadingProvider &&
    !loadingAllowance &&
    !providerError &&
    !!provider?.registry_provider_id &&
    needsApproval;

  const canSubmit =
    question.trim().length > 0 &&
    isConnected &&
    !!address &&
    hasSufficientAllowance &&
    !approveBusy &&
    !isTxBusy &&
    !isPolling &&
    phase !== "done" &&
    !loadingProvider &&
    !providerError &&
    !!provider?.registry_provider_id;

  async function handleApproveUsdc() {
    if (!canApprove || !address || !allowance) return;

    setErrorMsg("");
    setApproveTxHash(null);
    setApproveBusy(true);

    try {
      await ensureArcTestnet();
      const { to, data } = buildApproveUsdcTransaction(
        allowance.paymentToken,
        allowance.required,
      );
      const hash = await sendTransactionAsync({
        to,
        data,
        value: BigInt(0),
        chainId: arcTestnet.id,
      });
      setApproveTxHash(hash);

      const receipt = await arcPublicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") {
        throw new Error("USDC approve transaction reverted on-chain.");
      }

      await queryClient.invalidateQueries({
        queryKey: ["usdc-allowance", address],
      });
    } catch (err) {
      setErrorMsg(formatSubmitError(err));
      setPhase("error");
    } finally {
      setApproveBusy(false);
    }
  }

  const { data: job } = useQuery({
    queryKey: ["jobs", jobRequestId],
    queryFn: () => skillHub.jobs.get(jobRequestId!),
    enabled: !!jobRequestId && isPolling,
    refetchInterval: 2500,
  });

  useEffect(() => {
    if (!job || !isPolling) return;

    if (TERMINAL_FAILURE_STATUSES.has(job.status)) {
      setErrorMsg(`Job ended with status ${job.status}.`);
      setPhase("error");
      return;
    }

    if (phase === "waiting_funded" && job.job_id) {
      setPhase("waiting_output");
      return;
    }

    if (phase === "waiting_output" && job.output != null) {
      setPhase("done");
    }
  }, [job, phase, isPolling]);

  // useEffect(() => {
  //   if (
  //     phase !== "waiting_output" ||
  //     !job?.job_id ||
  //     !jobRequestId ||
  //     !provider?.api_base_url
  //   ) {
  //     return;
  //   }
  //   if (invokedForJobRef.current === jobRequestId) return;
  //   invokedForJobRef.current = jobRequestId;

  //   const message = question.trim();
  //   const apiBaseUrl = provider.api_base_url;

  //   (async () => {
  //     setInvokeError(null);
  //     try {
  //       //HERE
  //       const res = await fetch("/api/invoke-provider", {
  //         method: "POST",
  //         headers: { "Content-Type": "application/json" },
  //         body: JSON.stringify({
  //           api_base_url: apiBaseUrl,
  //           message,
  //           job_request_id: jobRequestId,
  //           skillhub_api_url: SKILLHUB_API_URL,
  //         }),
  //       });
  //       const data = (await res.json()) as { ok?: boolean; error?: string };
  //       console.log("data!!", data);
  //       if (!res.ok || !data.ok) {
  //         setInvokeError(
  //           data.error ??
  //             "Could not reach your agent API. Check api_base_url and that /chat accepts Skill Hub job payloads.",
  //         );
  //       }
  //     } catch (err) {
  //       setInvokeError(
  //         err instanceof Error ? err.message : "Failed to invoke provider API",
  //       );
  //     }
  //   })();
  // }, [phase, job?.job_id, jobRequestId, provider?.api_base_url, question]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !address || !provider?.registry_provider_id) return;

    setErrorMsg("");
    setInvokeError(null);
    setTxHash(null);
    setJobRequestId(null);
    invokedForJobRef.current = null;

    try {
      const trimmed = question.trim();
      const inputHash = await sha256Bytes32Hex(trimmed);

      if (!provider.registry_provider_id) {
        throw new Error("provider_registry_id_missing");
      }

      const jobPayload: CreateJobInput = {
        user_wallet: address,
        provider_id: provider.registry_provider_id,
        input: { uri: trimmed },
        input_hash: inputHash,
        queue_timeout_seconds: QUEUE_TIMEOUT_SECONDS,
        authorization_expires_in_seconds: AUTHORIZATION_EXPIRES_IN_SECONDS,
      };
      setPhase("signing");
      const prepared = await skillHub.jobs.create(jobPayload);
      const requestId = decodeCreateJobRequestId(prepared.data);
      setJobRequestId(requestId);

      if (
        prepared.chain_id !== undefined &&
        prepared.chain_id !== arcTestnet.id
      ) {
        throw new Error(
          `Prepared transaction targets chain ${prepared.chain_id}, expected Arc Testnet (${arcTestnet.id}).`,
        );
      }

      setPhase("switching");
      await ensureArcTestnet();

      setPhase("signing");
      const hash = await sendTransactionAsync({
        to: prepared.to as `0x${string}`,
        data: prepared.data as `0x${string}`,
        value: BigInt(prepared.value),
        chainId: arcTestnet.id,
      });
      setTxHash(hash);

      setPhase("confirming");
      const receipt = await arcPublicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") {
        throw new Error("createJob transaction reverted on-chain.");
      }

      setPhase("waiting_funded");
    } catch (err) {
      setErrorMsg(formatSubmitError(err));
      setPhase("error");
    }
  }

  const waitingTitle =
    phase === "waiting_funded" ? "Funding Job" : "Agent Working";
  const waitingDetail =
    phase === "waiting_funded"
      ? "Waiting for your createJob transaction to be indexed and linked to an on-chain job_id…"
      : invokeError
        ? `Calling your agent at ${provider?.api_base_url ?? "api_base_url"}… (${invokeError}) Still waiting for on-chain output.`
        : "Your job is funded — calling your agent API, then waiting for Skill Hub output…";

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
                Provider &quot;{providerRequestId}&quot; not found.
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
                  Submit a question. You fund the job on Arc Testnet; once
                  funded, this page calls your registered{" "}
                  <span className="font-mono">api_base_url</span>/chat with the
                  job id so your agent can run and post{" "}
                  <span className="font-mono">output</span> to Skill Hub.
                </p>
                <div className="text-[10px] uppercase tracking-widest text-black/35 space-y-1">
                  <div className="font-mono break-all">
                    URL id (request_id): {provider.request_id}
                  </div>
                  {provider.registry_provider_id ? (
                    <div>
                      job provider_id (on-chain):{" "}
                      {provider.registry_provider_id}
                    </div>
                  ) : (
                    <div className="text-[#E85A00]">
                      on-chain provider_id pending — complete registration first
                    </div>
                  )}
                  <div>
                    ${parseFloat(provider.price_usdc).toFixed(2)} USDC ·{" "}
                    {provider.service_type}
                  </div>
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
              Step 1: approve USDC. Step 2: create job and wait for the agent.
            </p>
          </div>
        </div>

        <div className="flex-1 px-6 md:px-10 py-12 md:py-16">
          {phase === "done" && job ? (
            <div className="flex flex-col items-start gap-6 max-w-2xl">
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
                Response Ready
              </h2>
              <div
                className="w-full p-5 text-sm leading-relaxed text-black/80 whitespace-pre-wrap"
                style={{
                  border: `1px solid ${GRID}`,
                  background: "rgba(255,255,255,0.35)",
                }}
              >
                {formatJobOutput(job.output)}
              </div>
              <div className="text-[10px] uppercase tracking-widest text-black/35 space-y-1 font-mono">
                {job.job_id && <div>job_id: {job.job_id}</div>}
                <div className="break-all">request_id: {job.request_id}</div>
                <div>status: {job.status}</div>
              </div>
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
              <button
                type="button"
                className="btn-cyber"
                onClick={() => {
                  setQuestion("");
                  setPhase("form");
                  setJobRequestId(null);
                  setTxHash(null);
                  setApproveTxHash(null);
                  setErrorMsg("");
                  if (address) {
                    void queryClient.invalidateQueries({
                      queryKey: ["usdc-allowance", address],
                    });
                  }
                }}
              >
                Ask Another Question <ArrowRight size={13} />
              </button>
            </div>
          ) : isPolling ? (
            <LoadingPanel
              title={waitingTitle}
              detail={waitingDetail}
              job={job}
            />
          ) : phase === "confirming" ? (
            <LoadingPanel
              title="Confirming Transaction"
              detail="Waiting for Arc Testnet confirmation…"
            />
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
                {provider && !provider.registry_provider_id && (
                  <p className="text-[11px] text-[#E85A00] font-medium mt-3">
                    This provider is not on-chain yet. Complete registration
                    before creating a job.
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
                  disabled={loadingProvider || isTxBusy || approveBusy}
                />
                <span className="text-[10px] text-black/35">
                  Sent as <span className="font-mono">input.uri</span> and{" "}
                  <span className="font-mono">input_hash</span> is SHA-256 of
                  this text (bytes32).
                </span>
              </div>

              {loadingAllowance &&
                isConnected &&
                provider?.registry_provider_id && (
                  <p className="text-sm text-black/40">
                    Checking USDC allowance…
                  </p>
                )}

              {needsApproval && (
                <p className="text-sm text-black/60 leading-relaxed max-w-lg">
                  Approve{" "}
                  <span className="font-semibold">
                    {allowance!.requiredLabel} USDC
                  </span>{" "}
                  below, then click Create Job.
                  <span className="block mt-1 text-black/45 text-xs">
                    Current allowance: {allowance!.allowanceLabel} USDC
                  </span>
                </p>
              )}

              {allowanceError && isConnected && (
                <p className="text-sm text-red-600">
                  Could not check USDC allowance. Refresh the page or try again.
                </p>
              )}

              {phase === "error" && (
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

              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-4 flex-wrap">
                  {!isConnected ? (
                    <span className="text-[11px] text-black/40">
                      Connect a wallet to continue.
                    </span>
                  ) : loadingAllowance ? (
                    <span className="text-[11px] text-black/40">
                      Checking USDC allowance…
                    </span>
                  ) : !provider?.registry_provider_id ? null : hasSufficientAllowance ? (
                    <button
                      type="submit"
                      disabled={!canSubmit}
                      className="btn-cyber disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {phase === "switching"
                        ? "Switching Network…"
                        : phase === "signing"
                          ? "Awaiting Signature…"
                          : "Create Job"}
                      {phase === "form" && <ArrowRight size={13} />}
                    </button>
                  ) : needsApproval ? (
                    <button
                      type="button"
                      onClick={handleApproveUsdc}
                      disabled={!canApprove}
                      className="btn-cyber disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {approveBusy ? "Awaiting Approval…" : "Approve USDC"}
                      {!approveBusy && <ArrowRight size={13} />}
                    </button>
                  ) : null}
                </div>
                {approveTxHash && (
                  <a
                    href={`https://testnet.arcscan.app/tx/${approveTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-[#E85A00] hover:underline flex items-center gap-1 break-all"
                  >
                    {approveTxHash}
                    <ExternalLink size={12} />
                  </a>
                )}
                {fetchingAllowance &&
                  !approveBusy &&
                  hasSufficientAllowance && (
                    <p className="text-[10px] text-black/40">
                      Refreshing allowance…
                    </p>
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
