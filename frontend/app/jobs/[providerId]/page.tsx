"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Zap, ExternalLink, Loader2 } from "lucide-react";
import { useAccount, useSendTransaction, useSignTypedData } from "wagmi";
import { arcTestnet } from "viem/chains";
import type { CreateJobInput, JobWithDetails } from "skillhub-sdk";
import NavMenu from "../../components/NavMenu";
import { ConnectButton } from "../../components/ConnectButton";
import { ensureArcTestnet } from "../../lib/arc-wallet";
import { arcPublicClient } from "../../lib/arc-public-client";
import { useWalletChainId } from "../../lib/useWalletChainId";
import { decodeCreateJobRequestId } from "../../lib/decode-create-job";
import { formatJobOutput } from "../../lib/format-job-output";
import {
  buildJobInputFromSchema,
  describeJobInputField,
} from "../../lib/build-job-input";
import {
  buildApproveUsdcTransaction,
  fetchUsdcAllowance,
} from "../../lib/escrow-payment";
import { apiKeys, fetchProvider } from "../../lib/api";
import {
  ACCEPTANCE_EXPIRES_IN_SECONDS,
  buildAcceptanceInput,
  parseAcceptanceTypedData,
} from "../../lib/accept-job";
import { useAuth } from "../../providers/AuthProvider";

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
  | "review"
  | "accepting"
  | "settled"
  | "error";

const inputClass =
  "w-full bg-transparent border border-black/15 px-4 py-3 text-sm placeholder:text-black/30 focus:outline-none focus:border-[#E85A00] transition-colors resize-none";

function formatSubmitError(err: unknown): string {
  const raw = err instanceof Error ? err.message : "Something went wrong";
  if (raw.includes("unauthorized") || raw.includes("401")) {
    return "Sign in with your wallet before creating or viewing jobs.";
  }
  if (raw.includes("user_wallet_mismatch")) {
    return "Connected wallet does not match your signed-in account.";
  }
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
  if (raw.includes("job_not_acceptance_ready")) {
    return "This job is not ready to accept yet. Wait for the provider to submit output.";
  }
  if (raw.includes("job_not_submitted")) {
    return "Output is not submitted yet. Wait for the provider to finish the job.";
  }
  if (raw.includes("acceptance_typed_data_invalid")) {
    return "Could not parse acceptance signature request from the API.";
  }
  return raw;
}

function waitingDetailForPhase(phase: Phase, job?: JobWithDetails): string {
  if (phase === "waiting_funded") {
    return "Waiting for your createJob transaction to be indexed and linked to an on-chain job_id…";
  }

  switch (job?.status) {
    case "FUNDED":
      return "Job is funded. Waiting for the provider SDK worker to start it (start-next-job-request → start-job → job-finish)…";
    case "RUNNING":
      return "Provider is processing your job…";
    case "SUBMITTED":
      return "Output submitted — loading result…";
    default:
      return `Waiting for provider output (status: ${job?.status ?? "…"})…`;
  }
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
  const { isAuthenticated, skillHub } = useAuth();
  const walletChainId = useWalletChainId();
  const onArc = walletChainId === arcTestnet.id;
  const { sendTransactionAsync } = useSendTransaction();
  const { signTypedDataAsync } = useSignTypedData();

  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [approveBusy, setApproveBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [settleTxHash, setSettleTxHash] = useState<string | null>(null);
  const [approveTxHash, setApproveTxHash] = useState<string | null>(null);
  const [jobRequestId, setJobRequestId] = useState<string | null>(null);

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
  const isAccepting = phase === "accepting";

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
    isAuthenticated &&
    !!address &&
    hasSufficientAllowance &&
    !approveBusy &&
    !isTxBusy &&
    !isPolling &&
    !isAccepting &&
    phase !== "review" &&
    phase !== "settled" &&
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

  const needsJobPolling =
    phase === "waiting_funded" ||
    phase === "waiting_output" ||
    phase === "review" ||
    phase === "accepting";

  const { data: job } = useQuery({
    queryKey: ["jobs", jobRequestId],
    queryFn: () => skillHub.jobs.get(jobRequestId!),
    enabled: !!jobRequestId && (needsJobPolling || phase === "settled"),
    refetchInterval: needsJobPolling ? 2500 : false,
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
      setPhase(job.status === "SETTLED" ? "settled" : "review");
    }
  }, [job, phase, isPolling]);

  async function handleAcceptOutput() {
    if (!job || !jobRequestId || !isAuthenticated) return;

    const jobId = job.job_id ?? jobRequestId;
    setErrorMsg("");
    setSettleTxHash(null);
    setPhase("accepting");

    try {
      await ensureArcTestnet();

      const outputCommitment = {
        output: job.output ?? undefined,
        expires_in_seconds: ACCEPTANCE_EXPIRES_IN_SECONDS,
      };

      const acceptanceRequest = await skillHub.jobs.requestAcceptance(
        jobId,
        outputCommitment,
      );
      const typedData = parseAcceptanceTypedData(acceptanceRequest.typed_data);

      const userSignature = await signTypedDataAsync({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.value,
      });

      const accepted = await skillHub.jobs.acceptance(
        jobId,
        buildAcceptanceInput(
          outputCommitment,
          acceptanceRequest,
          userSignature,
        ),
      );

      setSettleTxHash(accepted.transaction_hash);
      setPhase("settled");
      await queryClient.invalidateQueries({ queryKey: ["jobs", jobRequestId] });
    } catch (err) {
      setErrorMsg(formatSubmitError(err));
      setPhase("review");
    }
  }

  function resetForAnotherQuestion() {
    setQuestion("");
    setPhase("form");
    setJobRequestId(null);
    setTxHash(null);
    setSettleTxHash(null);
    setApproveTxHash(null);
    setErrorMsg("");
    if (address) {
      void queryClient.invalidateQueries({
        queryKey: ["usdc-allowance", address],
      });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !address || !provider?.registry_provider_id) return;

    setErrorMsg("");
    setTxHash(null);
    setJobRequestId(null);

    try {
      const trimmed = question.trim();
      const input = buildJobInputFromSchema(provider.input_schema, trimmed);
      if (!provider.registry_provider_id) {
        throw new Error("provider_registry_id_missing");
      }

      const jobPayload: CreateJobInput = {
        user_wallet: address,
        provider_id: provider.registry_provider_id,
        input,
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
  const waitingDetail = waitingDetailForPhase(phase, job);

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
                  Submit a question and fund the job on Arc Testnet. Your
                  provider&apos;s SDK worker picks up funded jobs, runs{" "}
                  <span className="font-mono">start-job</span>, and posts{" "}
                  <span className="font-mono">output</span> via{" "}
                  <span className="font-mono">job-finish</span>.
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
              Step 1: connect wallet and sign in. Step 2: approve USDC. Step 3:
              create job. Step 4: review output and accept to settle payment.
            </p>
          </div>
        </div>

        <div className="flex-1 px-6 md:px-10 py-12 md:py-16">
          {phase === "accepting" ? (
            <LoadingPanel
              title="Accepting Output"
              detail="Requesting acceptance payload, signing JobAcceptance in MetaMask, and relaying settlement on Arc Testnet…"
              job={job}
            />
          ) : (phase === "review" || phase === "settled") && job ? (
            <div className="flex flex-col items-start gap-6 max-w-2xl">
              <div
                className="w-12 h-12 flex items-center justify-center text-white text-xl"
                style={{
                  background: phase === "settled" ? "#0c0c0c" : "#E85A00",
                }}
              >
                {phase === "settled" ? "✓" : "!"}
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
                {phase === "settled" ? "Job Settled" : "Response Ready"}
              </h2>
              {phase === "review" && (
                <p className="text-sm text-black/60 leading-relaxed max-w-lg">
                  Review the agent&apos;s output below. Accept to sign{" "}
                  <span className="font-mono">JobAcceptance</span> and release
                  USDC to the provider.
                </p>
              )}
              {phase === "settled" && (
                <p className="text-sm text-black/60 leading-relaxed max-w-lg">
                  Payment settled on-chain. USDC has been released to the
                  provider.
                </p>
              )}
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
                <div>
                  status: {phase === "settled" ? "SETTLED" : job.status}
                </div>
              </div>
              {txHash && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-widest text-black/35">
                    Create job tx
                  </span>
                  <a
                    href={`https://testnet.arcscan.app/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-[#E85A00] hover:underline flex items-center gap-1 break-all"
                  >
                    {txHash}
                    <ExternalLink size={12} />
                  </a>
                </div>
              )}
              {settleTxHash && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-widest text-black/35">
                    Settlement tx
                  </span>
                  <a
                    href={`https://testnet.arcscan.app/tx/${settleTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-[#E85A00] hover:underline flex items-center gap-1 break-all"
                  >
                    {settleTxHash}
                    <ExternalLink size={12} />
                  </a>
                </div>
              )}
              {phase === "review" && errorMsg && (
                <div
                  className="p-3 text-xs text-red-700 break-words w-full"
                  style={{
                    border: "1px solid rgba(220, 38, 38, 0.3)",
                    background: "rgba(220, 38, 38, 0.05)",
                  }}
                >
                  {errorMsg}
                </div>
              )}
              <div className="flex items-center gap-4 flex-wrap">
                {phase === "review" && (
                  <button
                    type="button"
                    className="btn-cyber disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={!isAuthenticated}
                    onClick={() => void handleAcceptOutput()}
                  >
                    Accept Output <ArrowRight size={13} />
                  </button>
                )}
                {phase === "settled" && (
                  <button
                    type="button"
                    className="btn-cyber"
                    onClick={resetForAnotherQuestion}
                  >
                    Ask Another Question <ArrowRight size={13} />
                  </button>
                )}
              </div>
              {phase === "review" && !isAuthenticated && (
                <p className="text-[11px] text-black/40">
                  Sign in with your wallet to accept the output.
                </p>
              )}
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
                  Sent as{" "}
                  <span className="font-mono">
                    {describeJobInputField(provider?.input_schema)}
                  </span>
                  . On-chain <span className="font-mono">input_commitment</span>{" "}
                  is derived from the JSON payload.
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
                  ) : !isAuthenticated ? (
                    <span className="text-[11px] text-black/40">
                      Sign in with your wallet to create a job.
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
                          : "Send"}
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
