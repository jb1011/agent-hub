"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle, Clock, Loader2, Zap } from "lucide-react";
import { useAccount } from "wagmi";
import NavMenu from "../components/NavMenu";
import { ConnectButton } from "../components/ConnectButton";
import { apiKeys, fetchProvidersByOwner, type Provider } from "../lib/api";

const GRID = "rgba(0,0,0,0.12)";

const trustConfig: Record<
  string,
  { label: string; bg: string; color: string }
> = {
  CERTIFIED: { label: "Certified", bg: "#0C0C0C", color: "#fff" },
  VERIFIED: { label: "Verified", bg: "#E85A00", color: "#fff" },
  HOSTED: { label: "Hosted", bg: "transparent", color: "#0C0C0C" },
  UNVERIFIED: {
    label: "Unverified",
    bg: "transparent",
    color: "rgba(0,0,0,0.35)",
  },
};

const trustBorder: Record<string, string> = {
  CERTIFIED: "none",
  VERIFIED: "none",
  HOSTED: "1px solid rgba(0,0,0,0.25)",
  UNVERIFIED: "1px solid rgba(0,0,0,0.15)",
};

const statusDot: Record<string, string> = {
  ACTIVE: "#22c55e",
  REGISTERED: "#E85A00",
  SUSPENDED: "#ef4444",
};

function TrustBadge({ level }: { level: string }) {
  const cfg = trustConfig[level] ?? trustConfig.UNVERIFIED;
  const border = trustBorder[level] ?? trustBorder.UNVERIFIED;
  const Icon =
    level === "CERTIFIED" || level === "VERIFIED"
      ? CheckCircle
      : level === "HOSTED"
        ? Zap
        : Clock;
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 shrink-0"
      style={{ background: cfg.bg, color: cfg.color, border }}
    >
      <Icon size={9} />
      {cfg.label}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      dateStyle: "medium",
    });
  } catch {
    return iso;
  }
}

function ProviderRow({
  provider,
  index,
}: {
  provider: Provider;
  index: number;
}) {
  const dot = statusDot[provider.status] ?? statusDot.REGISTERED;
  const onChain = provider.registry_provider_id;

  return (
    <div
      className="flex flex-col md:grid items-start md:items-center px-6 md:px-10 py-4 gap-3 md:gap-4"
      style={{
        gridTemplateColumns: "2rem 1fr 7rem 6rem 7rem 6rem 6rem",
        borderBottom: `1px solid ${GRID}`,
      }}
    >
      <span className="hidden md:block text-[11px] font-mono text-black/25 tabular-nums">
        {String(index + 1).padStart(2, "0")}
      </span>

      <div className="min-w-0 w-full">
        <div className="font-semibold text-sm text-black">{provider.name}</div>
        {provider.description ? (
          <p className="text-[11px] text-black/45 mt-0.5 line-clamp-2">
            {provider.description}
          </p>
        ) : null}
        <p
          className="text-[10px] font-mono text-black/30 mt-1 break-all"
          title={provider.request_id}
        >
          {provider.request_id}
        </p>
      </div>

      <span className="text-[11px] font-mono uppercase tracking-wider text-black/50">
        {provider.service_type}
      </span>

      <span
        className="text-sm font-bold tabular-nums"
        style={{ color: "#E85A00" }}
      >
        ${parseFloat(provider.price_usdc).toFixed(2)}
        <span className="text-[9px] font-normal text-black/35 ml-1">USDC</span>
      </span>

      <div className="min-w-0">
        {onChain ? (
          <span
            className="text-[10px] font-mono text-black/55 break-all"
            title={onChain}
          >
            #{onChain}
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-wider text-[#E85A00]">
            Pending
          </span>
        )}
      </div>

      <div className="min-w-0">
        <TrustBadge level={provider.trust_level} />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <div
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: dot }}
          />
          <span className="text-[10px] uppercase tracking-wider text-black/50">
            {provider.status}
          </span>
        </div>
        <span className="text-[10px] text-black/35">
          {formatDate(provider.created_at)}
        </span>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div
      className="grid items-center px-6 md:px-10 py-4 gap-4 animate-pulse"
      style={{
        gridTemplateColumns: "2rem 1fr 7rem 6rem 7rem 6rem 6rem",
        borderBottom: `1px solid ${GRID}`,
      }}
    >
      <div className="h-3 w-5 bg-black/10 rounded" />
      <div className="h-4 w-48 bg-black/10 rounded" />
      <div className="h-3 w-24 bg-black/10 rounded" />
      <div className="h-3 w-16 bg-black/10 rounded" />
      <div className="h-3 w-20 bg-black/10 rounded" />
      <div className="h-3 w-16 bg-black/10 rounded" />
      <div className="h-3 w-14 bg-black/10 rounded" />
    </div>
  );
}

export default function MyProvidersPage() {
  const { address, isConnected } = useAccount();

  const {
    data: providers = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: apiKeys.myProviders(address ?? ""),
    queryFn: () => fetchProvidersByOwner(address!),
    enabled: isConnected && !!address,
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
          My Providers
        </span>
        {isConnected && !isLoading && (
          <>
            <span className="text-black/20">·</span>
            <span className="text-xs text-black/40">
              {providers.length} provider{providers.length !== 1 ? "s" : ""}
            </span>
          </>
        )}
      </div>

      <div
        className="flex flex-col md:flex-row"
        style={{ minHeight: "calc(100vh - 112px)" }}
      >
        <div
          className="md:w-[32%] shrink-0 px-6 md:px-10 py-12 md:py-16 flex flex-col justify-between"
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
              Providers
            </h1>
            <p className="text-sm text-black/60 leading-relaxed max-w-xs mb-8">
              Agents registered with your connected wallet as owner. Finish
              on-chain registration from the Register page if status shows
              pending.
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
        </div>

        <div className="flex-1 min-w-0">
          <div className="px-6 md:px-10 py-8 md:py-10 border-b border-black/10">
            <div className="text-[10px] uppercase tracking-widest font-bold text-black/40 mb-4">
              Wallet
            </div>
            <ConnectButton />
          </div>

          {!isConnected ? (
            <div className="px-6 md:px-10 py-12 text-sm text-black/50">
              Connect your wallet to see providers you own.
            </div>
          ) : isLoading ? (
            <section>
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </section>
          ) : isError ? (
            <div className="px-6 md:px-10 py-12 flex flex-col gap-3">
              <p className="text-sm text-red-600">
                {error instanceof Error
                  ? error.message
                  : "Could not load your providers."}
              </p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="btn-cyber w-fit"
              >
                Retry
              </button>
            </div>
          ) : providers.length === 0 ? (
            <div className="px-6 md:px-10 py-12 flex flex-col gap-4">
              <p className="text-sm text-black/50">
                No providers registered for this wallet yet.
              </p>
              <Link href="/register" className="btn-cyber w-fit">
                Register Your First Provider <ArrowRight size={13} />
              </Link>
            </div>
          ) : (
            <>
              <div
                className="hidden md:grid items-center px-6 md:px-10 py-3 gap-4"
                style={{
                  gridTemplateColumns: "2rem 1fr 7rem 6rem 7rem 6rem 6rem",
                  borderBottom: `1px solid ${GRID}`,
                  background: "rgba(0,0,0,0.03)",
                }}
              >
                {[
                  "#",
                  "Provider",
                  "Type",
                  "Price",
                  "On-chain",
                  "Trust",
                  "Status",
                ].map((col) => (
                  <span
                    key={col}
                    className="text-[10px] font-bold uppercase tracking-widest text-black/40"
                  >
                    {col}
                  </span>
                ))}
              </div>
              {isFetching && !isLoading && (
                <div className="px-6 md:px-10 py-2 text-[10px] uppercase tracking-widest text-black/35">
                  Refreshing…
                </div>
              )}
              <section>
                {providers.map((provider, i) => (
                  <ProviderRow
                    key={provider.request_id}
                    provider={provider}
                    index={i}
                  />
                ))}
              </section>
            </>
          )}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${GRID}` }} />
    </div>
  );
}
