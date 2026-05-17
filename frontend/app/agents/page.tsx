"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Zap, Shield, CheckCircle, Clock } from "lucide-react";
import NavMenu from "../components/NavMenu";
import { fetchProviders, fetchServices, apiKeys, type Provider, type Service } from "../lib/api";

const GRID = "rgba(0,0,0,0.12)";

const trustConfig: Record<string, { label: string; bg: string; color: string }> = {
  CERTIFIED: { label: "Certified", bg: "#0C0C0C", color: "#fff" },
  VERIFIED:  { label: "Verified",  bg: "#E85A00", color: "#fff" },
  HOSTED:    { label: "Hosted",    bg: "transparent", color: "#0C0C0C" },
  UNVERIFIED:{ label: "Unverified",bg: "transparent", color: "rgba(0,0,0,0.4)" },
};

const trustBorder: Record<string, string> = {
  CERTIFIED: "none",
  VERIFIED:  "none",
  HOSTED:    "1px solid rgba(0,0,0,0.25)",
  UNVERIFIED:"1px solid rgba(0,0,0,0.15)",
};

function TrustIcon({ level }: { level: string }) {
  if (level === "CERTIFIED" || level === "VERIFIED")
    return <CheckCircle size={12} className="inline ml-1 opacity-70" />;
  if (level === "HOSTED")
    return <Zap size={12} className="inline ml-1 opacity-50" />;
  return <Clock size={12} className="inline ml-1 opacity-30" />;
}

function SkeletonCard() {
  return (
    <div
      className="p-7 animate-pulse"
      style={{ borderRight: `1px solid ${GRID}`, borderBottom: `1px solid ${GRID}` }}
    >
      <div className="w-12 h-12 bg-black/10 mb-5" />
      <div className="h-3 w-16 bg-black/10 mb-2 rounded" />
      <div className="h-6 w-40 bg-black/10 mb-3 rounded" />
      <div className="h-3 w-full bg-black/10 mb-1 rounded" />
      <div className="h-3 w-2/3 bg-black/10 mb-8 rounded" />
      <div className="h-3 w-20 bg-black/10 rounded" />
    </div>
  );
}

export default function AgentsPage() {
  const { data: providers = [], isLoading, isError } = useQuery<Provider[]>({
    queryKey: apiKeys.providers,
    queryFn: fetchProviders,
  });

  const { data: services = [] } = useQuery<Service[]>({
    queryKey: apiKeys.services,
    queryFn: fetchServices,
  });

  const serviceCountByProvider = services.reduce<Record<string, number>>((acc, s) => {
    acc[s.provider_id] = (acc[s.provider_id] ?? 0) + 1;
    return acc;
  }, {});

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
        {/* Vertical grid lines */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)" }}
        >
          {[...Array(5)].map((_, i) => (
            <div key={i} style={{ gridColumn: i + 2, borderLeft: `1px solid ${GRID}` }} />
          ))}
        </div>

        <div className="relative flex flex-col md:flex-row">
          {/* Left: description */}
          <div
            className="flex flex-col justify-end px-6 md:px-10 pb-8 pt-16 md:pt-0 md:w-[30%] shrink-0"
            style={{ borderRight: `1px solid ${GRID}` }}
          >
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2" style={{ background: "#E85A00" }} />
                <span className="text-xs font-semibold tracking-widest uppercase text-black/50">
                  Agent Directory
                </span>
              </div>
              <p className="text-sm leading-relaxed text-black/70 max-w-xs">
                Every registered provider on Skill Hub — vetted, trusted, and
                ready to integrate into your workflow.
              </p>
            </div>
            <a href="/" className="btn-cyber">
              ← Back to Marketplace
            </a>
          </div>

          {/* Center: headline */}
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
              ALL
              <br />
              AGENTS
            </h1>
          </div>

          {/* Right: count */}
          <div
            className="hidden md:flex flex-col justify-between w-[18%] shrink-0 py-8 px-5"
            style={{ borderLeft: `1px solid ${GRID}` }}
          >
            <div>
              <div className="text-xs font-semibold tracking-widest uppercase text-black/40 mb-3">
                Registry
              </div>
              <div
                style={{ borderBottom: `1px solid ${GRID}`, paddingBottom: "12px" }}
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
              <div className="mt-4" style={{ borderBottom: `1px solid ${GRID}`, paddingBottom: "12px" }}>
                <div className="text-[10px] uppercase tracking-widest text-black/40">
                  Total Services
                </div>
                <div
                  className="text-2xl font-bold mt-0.5"
                  style={{
                    fontFamily: "var(--font-bebas-neue), sans-serif",
                    color: "#0C0C0C",
                  }}
                >
                  {isLoading ? "—" : services.length}
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
          Registered Providers
        </span>
        <div className="flex-1" />
        {!isLoading && (
          <span className="text-xs text-black/40">
            {providers.length} provider{providers.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── AGENT GRID ── */}
      {isError ? (
        <div
          className="p-12 text-center text-sm text-black/40"
          style={{ borderBottom: `1px solid ${GRID}` }}
        >
          Failed to load providers. Make sure the backend is running.
        </div>
      ) : (
        <section
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
          style={{ borderBottom: `1px solid ${GRID}` }}
        >
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
            : providers.length === 0
            ? (
              <div className="col-span-3 p-12 text-center text-sm text-black/40">
                No providers registered yet.
              </div>
            )
            : providers.map((provider) => {
                const cfg = trustConfig[provider.trust_level] ?? trustConfig.UNVERIFIED;
                const border = trustBorder[provider.trust_level] ?? trustBorder.UNVERIFIED;
                const serviceCount = serviceCountByProvider[provider.provider_id] ?? 0;

                return (
                  <div
                    key={provider.provider_id}
                    className="flex flex-col justify-between p-7 group cursor-pointer transition-colors hover:bg-black/[0.03]"
                    style={{
                      borderRight: `1px solid ${GRID}`,
                      borderBottom: `1px solid ${GRID}`,
                    }}
                  >
                    <div>
                      {/* Avatar + badge row */}
                      <div className="flex items-start justify-between mb-5">
                        <div
                          className="w-12 h-12 flex items-center justify-center text-white text-sm font-bold"
                          style={{ background: "#0C0C0C" }}
                        >
                          {provider.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span
                          className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 flex items-center"
                          style={{
                            background: cfg.bg,
                            color: cfg.color,
                            border,
                            letterSpacing: "0.12em",
                          }}
                        >
                          {cfg.label}
                          <TrustIcon level={provider.trust_level} />
                        </span>
                      </div>

                      {/* Provider name */}
                      <div className="mb-1">
                        <span
                          className="text-[10px] font-bold uppercase tracking-widest"
                          style={{ color: "#E85A00", letterSpacing: "0.14em" }}
                        >
                          Provider
                        </span>
                      </div>
                      <h3
                        className="font-bold mb-3"
                        style={{
                          fontFamily: "var(--font-bebas-neue), sans-serif",
                          fontSize: "1.6rem",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {provider.name}
                      </h3>

                      {/* Provider ID */}
                      <p className="text-[10px] font-mono text-black/30 mb-4 break-all">
                        {provider.provider_id}
                      </p>
                    </div>

                    {/* Footer row */}
                    <div
                      className="flex items-center justify-between pt-4"
                      style={{ borderTop: `1px solid ${GRID}` }}
                    >
                      <span className="text-xs text-black/50">
                        <span className="font-semibold text-black/70">{serviceCount}</span>{" "}
                        service{serviceCount !== 1 ? "s" : ""}
                      </span>
                      <button className="btn-cyber" style={{ padding: "8px 14px", fontSize: "0.6rem" }}>
                        View Services <ArrowRight size={10} />
                      </button>
                    </div>
                  </div>
                );
              })}
        </section>
      )}

      {/* ── FOOTER ── */}
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
            SkillHub
          </span>
        </div>
        <div className="flex flex-wrap gap-6 text-[10px] uppercase tracking-widest font-medium text-black/40">
          {["Privacy", "Terms", "Docs", "Status", "GitHub"].map((link) => (
            <a key={link} href="#" className="hover:text-black transition-colors">
              {link}
            </a>
          ))}
        </div>
        <div className="text-[10px] text-black/30 uppercase tracking-widest">
          © 2026 SkillHub
        </div>
      </footer>
    </div>
  );
}
