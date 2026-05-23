"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, Zap } from "lucide-react";
import { useAccount } from "wagmi";
import type { Job } from "skillhub-sdk";
import NavMenu from "../components/NavMenu";
import { ConnectButton } from "../components/ConnectButton";
import { apiKeys, fetchProviders } from "../lib/api";
import { formatJobPayload } from "../lib/format-job-output";
import { useAuth } from "../providers/AuthProvider";

const GRID = "rgba(0,0,0,0.12)";

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  CREATED: { bg: "rgba(0,0,0,0.08)", color: "#0c0c0c" },
  FUNDED: { bg: "rgba(59,130,246,0.12)", color: "#1d4ed8" },
  RUNNING: { bg: "rgba(234,88,12,0.12)", color: "#E85A00" },
  SUBMITTED: { bg: "rgba(168,85,247,0.12)", color: "#7e22ce" },
  ACCEPTED: { bg: "rgba(34,197,94,0.12)", color: "#15803d" },
  SETTLED: { bg: "rgba(34,197,94,0.2)", color: "#15803d" },
  FAILED: { bg: "rgba(220,38,38,0.1)", color: "#b91c1c" },
  EXPIRED: { bg: "rgba(220,38,38,0.1)", color: "#b91c1c" },
  REFUNDED: { bg: "rgba(220,38,38,0.1)", color: "#b91c1c" },
  DISPUTED: { bg: "rgba(220,38,38,0.1)", color: "#b91c1c" },
};

function statusStyle(status: string) {
  return STATUS_STYLES[status] ?? STATUS_STYLES.CREATED;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function JobCard({
  job,
  providerName,
}: {
  job: Job;
  providerName?: string | null;
}) {
  const badge = statusStyle(job.status);

  return (
    <article
      className="flex flex-col gap-4 p-5"
      style={{
        border: `1px solid ${GRID}`,
        background: "rgba(255,255,255,0.35)",
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          {providerName ? (
            <a
              href={`/jobs/${encodeURIComponent(job.provider_request_id)}`}
              className="text-sm font-semibold text-black hover:text-[#E85A00] transition-colors truncate"
            >
              {providerName}
            </a>
          ) : (
            <span className="text-sm font-semibold text-black/50">
              Unknown agent
            </span>
          )}
          <span className="text-[10px] uppercase tracking-widest text-black/35">
            Agent
          </span>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className="text-[10px] font-bold uppercase tracking-widest px-2 py-1"
            style={{ background: badge.bg, color: badge.color }}
          >
            {job.status}
          </span>
          <span className="text-[10px] text-black/40 uppercase tracking-widest">
            {formatDate(job.created_at)}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="text-[10px] uppercase tracking-widest font-bold text-black/40">
            Input
          </span>
          <p className="text-sm text-black/75 whitespace-pre-wrap break-words leading-relaxed">
            {formatJobPayload(job.input)}
          </p>
        </div>
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="text-[10px] uppercase tracking-widest font-bold text-black/40">
            Output
          </span>
          <p className="text-sm text-black/75 whitespace-pre-wrap break-words leading-relaxed">
            {formatJobPayload(job.output, "Pending…")}
          </p>
        </div>
      </div>
    </article>
  );
}

export default function HistoryPage() {
  const { isConnected } = useAccount();
  const { isAuthenticated, skillHub } = useAuth();

  const canLoadJobs = isConnected && isAuthenticated;

  const { data: providers } = useQuery({
    queryKey: apiKeys.providers,
    queryFn: fetchProviders,
    enabled: canLoadJobs,
  });

  const providerNames = new Map(
    providers?.map((provider) => [provider.request_id, provider.name]) ?? [],
  );

  const {
    data: jobs,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["jobs", "history"],
    queryFn: () => skillHub.jobs.list(),
    enabled: canLoadJobs,
  });

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
          Job History
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
              Your
              <br />
              Job
              <br />
              History
            </h1>
            <p className="text-sm text-black/60 leading-relaxed max-w-xs mb-8">
              Jobs funded from your connected wallet. Connect MetaMask and sign
              in to load your past requests, inputs, outputs, and statuses.
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

          <div className="mt-10 flex flex-col gap-3">
            <a href="/agents" className="btn-cyber w-fit">
              Browse Agents <ArrowRight size={13} />
            </a>
          </div>
        </div>

        <div className="flex-1 px-6 md:px-10 py-12 md:py-16">
          <div className="max-w-3xl flex flex-col gap-8">
            <div>
              <div className="text-[10px] uppercase tracking-widest font-bold text-black/40 mb-4">
                Wallet
              </div>
              <ConnectButton />
            </div>

            {!isConnected ? (
              <p className="text-sm text-black/50">
                Connect your wallet to view job history.
              </p>
            ) : !isAuthenticated ? (
              <p className="text-sm text-black/50">
                Sign in with your wallet to load jobs linked to your address.
              </p>
            ) : isLoading ? (
              <div className="flex items-center gap-3 text-sm text-black/50">
                <Loader2 size={18} className="animate-spin text-[#E85A00]" />
                Loading your jobs…
              </div>
            ) : isError ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-red-600">
                  {error instanceof Error
                    ? error.message
                    : "Could not load job history."}
                </p>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="btn-cyber w-fit"
                >
                  Retry
                </button>
              </div>
            ) : !jobs?.length ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-black/50">
                  No jobs yet for this wallet.
                </p>
                <a href="/agents" className="btn-cyber w-fit">
                  Find an Agent <ArrowRight size={13} />
                </a>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] uppercase tracking-widest text-black/40">
                    {jobs.length} job{jobs.length === 1 ? "" : "s"}
                  </span>
                  {isFetching && !isLoading && (
                    <span className="text-[10px] text-black/35 uppercase tracking-widest">
                      Refreshing…
                    </span>
                  )}
                </div>
                {jobs.map((job) => (
                  <JobCard
                    key={job.request_id}
                    job={job}
                    providerName={providerNames.get(job.provider_request_id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${GRID}` }} />
    </div>
  );
}
