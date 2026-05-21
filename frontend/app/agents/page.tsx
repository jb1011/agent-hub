"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Zap, CheckCircle, Clock } from "lucide-react";
import NavMenu from "../components/NavMenu";
import { fetchProviders, apiKeys, type Provider } from "../lib/api";

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

function shortenAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

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

function SkeletonRow() {
  return (
    <div
      className="grid items-center px-6 md:px-10 py-4 gap-4 animate-pulse"
      style={{
        gridTemplateColumns: "2rem 1fr 8rem 6rem 7rem 6rem",
        borderBottom: `1px solid ${GRID}`,
      }}
    >
      <div className="h-3 w-5 bg-black/10 rounded" />
      <div className="h-4 w-48 bg-black/10 rounded" />
      <div className="h-3 w-32 bg-black/10 rounded" />
      <div className="h-3 w-16 bg-black/10 rounded" />
      <div className="h-3 w-12 bg-black/10 rounded" />
    </div>
  );
}

export default function AgentsPage() {
  const {
    data: providers = [],
    isLoading,
    isError,
  } = useQuery<Provider[]>({
    queryKey: apiKeys.providers,
    queryFn: fetchProviders,
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

      {/* ── PAGE HEADER ── */}
      <section
        className="relative overflow-hidden"
        style={{ borderBottom: `1px solid ${GRID}` }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)" }}
        >
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              style={{ gridColumn: i + 2, borderLeft: `1px solid ${GRID}` }}
            />
          ))}
        </div>

        <div className="relative flex flex-col md:flex-row">
          <div className="flex flex-col justify-end px-6 md:px-10 pb-8 pt-16 md:pt-0 md:w-[30%] shrink-0">
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2" style={{ background: "#E85A00" }} />
                <span className="text-xs font-semibold tracking-widest uppercase text-black/50">
                  Agent Directory
                </span>
              </div>
              <p className="text-sm leading-relaxed text-black/70 max-w-xs">
                Every registered provider on Agent Hub — vetted, trusted, and
                ready to integrate into your workflow.
              </p>
            </div>
            <a href="/" className="btn-cyber">
              ← Back to Marketplace
            </a>
          </div>

          <div className="flex-1 flex flex-col justify-center px-4 md:px-8 py-8 md:py-16 overflow-hidden">
            <h1
              className="leading-none uppercase text-black select-none"
              style={{
                fontFamily: "var(--font-bebas-neue), sans-serif",
                fontSize: "clamp(64px, 11vw, 160px)",
                letterSpacing: "-0.01em",
                lineHeight: 0.92,
              }}
            >
              ALL AGENTS
            </h1>
          </div>

          <div className="hidden md:flex flex-col justify-between w-[18%] shrink-0 py-8 px-5">
            <div>
              <div className="text-xs font-semibold tracking-widest uppercase text-black/40 mb-3">
                Registry
              </div>
              <div
                style={{
                  borderBottom: `1px solid ${GRID}`,
                  paddingBottom: "12px",
                }}
              >
                <div className="text-[10px] uppercase tracking-widest text-black/40">
                  Total Providers
                </div>
                <div
                  className="text-2xl font-bold mt-0.5"
                  style={{
                    fontFamily: "var(--font-bebas-neue), sans-serif",
                    color: "#0C0C0C",
                  }}
                >
                  {isLoading ? "—" : providers.length}
                </div>
              </div>
            </div>
            <div className="text-[10px] uppercase tracking-widest text-black/30">
              Live data
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION LABEL ── */}
      <div
        className="flex items-center gap-3 px-6 md:px-10 py-4"
        style={{ borderBottom: `1px solid ${GRID}` }}
      >
        <div className="w-2 h-2" style={{ background: "#E85A00" }} />
        <span className="text-xs font-semibold tracking-widest uppercase text-black/50">
          All Providers
        </span>
        <div className="flex-1" />
        {!isLoading && (
          <span className="text-xs text-black/40">
            {providers.length} provider{providers.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── TABLE HEADER ── */}
      <div
        className="hidden md:grid items-center px-6 md:px-10 py-3 gap-4"
        style={{
          gridTemplateColumns: "2rem 1fr 8rem 6rem 7rem 6rem",
          borderBottom: `1px solid ${GRID}`,
          background: "rgba(0,0,0,0.03)",
        }}
      >
        {["#", "Provider", "Type", "Price", "Trust", "Status"].map((col) => (
          <span
            key={col}
            className="text-[10px] font-bold uppercase tracking-widest text-black/40"
          >
            {col}
          </span>
        ))}
      </div>

      {/* ── PROVIDER ROWS ── */}
      {isError ? (
        <div
          className="p-12 text-center text-sm text-black/40"
          style={{ borderBottom: `1px solid ${GRID}` }}
        >
          Failed to load providers. Make sure the backend is running.
        </div>
      ) : isLoading ? (
        <section style={{ borderBottom: `1px solid ${GRID}` }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </section>
      ) : providers.length === 0 ? (
        <div
          className="p-12 text-center text-sm text-black/40"
          style={{ borderBottom: `1px solid ${GRID}` }}
        >
          No providers registered yet.{" "}
          <a href="/register" className="text-[#E85A00] hover:underline">
            Register one
          </a>
          .
        </div>
      ) : (
        <section style={{ borderBottom: `1px solid ${GRID}` }}>
          {providers.map((provider, i) => {
            const dot = statusDot[provider.status] ?? statusDot.REGISTERED;

            return (
              <Link
                key={provider.request_id}
                href={`/jobs/${encodeURIComponent(provider.request_id)}`}
                className="group flex flex-col md:grid items-center px-6 md:px-10 py-4 gap-4 cursor-pointer transition-colors hover:bg-black/[0.025]"
                style={{
                  gridTemplateColumns: "2rem 1fr 8rem 6rem 7rem 6rem",
                  borderBottom: `1px solid ${GRID}`,
                }}
              >
                <span className="hidden md:block text-[11px] font-mono text-black/25 tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>

                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-black truncate">
                      {provider.name}
                    </span>
                    <span
                      className="text-[10px] font-mono text-black/30 truncate max-w-[12rem]"
                      title={provider.request_id}
                    >
                      {provider.request_id.slice(0, 10)}…
                    </span>
                    <ArrowUpRight
                      size={13}
                      className="shrink-0 opacity-0 group-hover:opacity-40 transition-opacity"
                    />
                  </div>
                  {provider.description ? (
                    <p className="text-[11px] text-black/45 mt-0.5 truncate">
                      {provider.description}
                    </p>
                  ) : (
                    <p className="text-[11px] text-black/30 mt-0.5 font-mono truncate">
                      {shortenAddress(provider.owner_wallet)}
                    </p>
                  )}
                </div>

                <span className="text-[11px] font-mono uppercase tracking-wider text-black/50 truncate">
                  {provider.service_type}
                </span>

                <span
                  className="text-sm font-bold tabular-nums"
                  style={{ color: "#E85A00" }}
                >
                  ${parseFloat(provider.price_usdc).toFixed(2)}
                  <span className="text-[9px] font-normal text-black/35 ml-1">
                    USDC
                  </span>
                </span>

                <div className="min-w-0">
                  <TrustBadge level={provider.trust_level} />
                </div>

                <div className="flex items-center gap-1.5">
                  <div
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: dot }}
                  />
                  <span className="text-[10px] uppercase tracking-wider text-black/50">
                    {provider.status}
                  </span>
                </div>
              </Link>
            );
          })}
        </section>
      )}

      <footer
        className="flex flex-col md:flex-row items-start md:items-center justify-between px-6 md:px-10 py-6 gap-4"
        style={{ borderBottom: `1px solid ${GRID}` }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-5 h-5 flex items-center justify-center"
            style={{ background: "#E85A00" }}
          >
            <Zap size={10} className="text-white fill-white" />
          </div>
          <span
            className="text-xs font-semibold tracking-widest uppercase"
            style={{ letterSpacing: "0.18em" }}
          >
            AgentHub
          </span>
        </div>
        <div className="flex flex-wrap gap-6 text-[10px] uppercase tracking-widest font-medium text-black/40">
          <a
            href="https://github.com/jb1011/agent-hub"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-black transition-colors"
          >
            GitHub
          </a>
        </div>
        <div className="text-[10px] text-black/30 uppercase tracking-widest">
          © 2026 AgentHub
        </div>
      </footer>
    </div>
  );
}
