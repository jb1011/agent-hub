"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Star } from "lucide-react";
import { fetchProviders, apiKeys, type Provider } from "../lib/api";

const GRID = "rgba(0,0,0,0.12)";

const statusColor: Record<string, string> = {
  ACTIVE: "#22c55e",
  REGISTERED: "#E85A00",
  SUSPENDED: "#ef4444",
};

const badgeForTrust: Record<string, string | null> = {
  CERTIFIED: "Verified",
  VERIFIED: "Verified",
  HOSTED: "Hosted",
  UNVERIFIED: null,
};

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={11}
          className={
            i <= Math.round(rating)
              ? "fill-[#E85A00] text-[#E85A00]"
              : "text-black/20 fill-black/10"
          }
        />
      ))}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div
      className="flex flex-col p-7 animate-pulse"
      style={{ borderRight: `1px solid ${GRID}`, borderBottom: `1px solid ${GRID}` }}
    >
      <div className="w-10 h-10 bg-black/10 mb-5" />
      <div className="h-3 w-16 bg-black/10 mb-2 rounded" />
      <div className="h-5 w-32 bg-black/10 mb-3 rounded" />
      <div className="h-3 w-full bg-black/10 mb-1 rounded" />
      <div className="h-3 w-3/4 bg-black/10 mb-8 rounded" />
      <div className="mt-auto h-3 w-24 bg-black/10 rounded" />
    </div>
  );
}

export function ServiceGrid() {
  const [activeCategory, setActiveCategory] = useState("ALL");

  const { data: providers = [], isLoading } = useQuery<Provider[]>({
    queryKey: apiKeys.providers,
    queryFn: fetchProviders,
  });

  const allTypes = Array.from(new Set(providers.map((p) => p.service_type)));
  const categories = ["ALL", ...allTypes];

  const filtered =
    activeCategory === "ALL"
      ? providers
      : providers.filter((p) => p.service_type === activeCategory);

  return (
    <>
      <div
        className="flex items-center overflow-x-auto"
        style={{ borderBottom: `1px solid ${GRID}` }}
      >
        {(isLoading ? ["ALL"] : categories).map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className="shrink-0 px-5 py-3.5 text-xs font-bold uppercase tracking-widest transition-colors cursor-pointer"
            style={{
              borderRight: `1px solid ${GRID}`,
              background: activeCategory === cat ? "#E85A00" : "transparent",
              color: activeCategory === cat ? "#fff" : "rgba(0,0,0,0.5)",
              letterSpacing: "0.14em",
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      <section
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
        style={{ borderBottom: `1px solid ${GRID}` }}
      >
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
          : filtered.length === 0
            ? (
              <div className="col-span-3 p-12 text-center text-sm text-black/40">
                No providers in this category.
              </div>
            )
            : filtered.map((p) => {
                const badge = badgeForTrust[p.trust_level] ?? null;
                const jobHref = `/jobs/${encodeURIComponent(p.request_id)}`;

                return (
                  <Link
                    key={p.request_id}
                    href={jobHref}
                    className="flex flex-col justify-between p-7 group cursor-pointer transition-colors hover:bg-black/[0.03]"
                    style={{
                      borderRight: `1px solid ${GRID}`,
                      borderBottom: `1px solid ${GRID}`,
                    }}
                  >
                    <div>
                      <div className="flex items-start justify-between mb-5">
                        <div
                          className="w-10 h-10 flex items-center justify-center text-white text-xs font-bold shrink-0"
                          style={{ background: "#0C0C0C" }}
                        >
                          {p.name.slice(0, 2).toUpperCase()}
                        </div>
                        {badge && (
                          <span
                            className="text-[9px] font-bold uppercase tracking-widest px-2 py-1"
                            style={{
                              background: badge === "Verified" ? "#0C0C0C" : "#E85A00",
                              color: "#fff",
                              letterSpacing: "0.12em",
                            }}
                          >
                            {badge}
                          </span>
                        )}
                      </div>

                      <div className="mb-1">
                        <span
                          className="text-[10px] font-bold uppercase tracking-widest"
                          style={{ color: "#E85A00", letterSpacing: "0.14em" }}
                        >
                          {p.service_type}
                        </span>
                      </div>
                      <h3
                        className="text-xl font-bold mb-2"
                        style={{
                          fontFamily: "var(--font-bebas-neue), sans-serif",
                          letterSpacing: "0.04em",
                          fontSize: "1.35rem",
                        }}
                      >
                        {p.name}
                      </h3>
                      {p.description && (
                        <p className="text-xs leading-relaxed text-black/60 mb-5">
                          {p.description}
                        </p>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center gap-1.5 mb-3">
                        <StarRating rating={4.7} />
                        <span className="flex items-center gap-1">
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{
                              background: statusColor[p.status] ?? statusColor.REGISTERED,
                            }}
                          />
                          <span className="text-[10px] text-black/40 uppercase tracking-widest">
                            {p.status}
                          </span>
                        </span>
                      </div>
                      <div
                        className="flex items-center justify-between pt-3"
                        style={{ borderTop: `1px solid ${GRID}` }}
                      >
                        <div>
                          <span className="text-xs font-semibold text-black/60">
                            ${p.price_usdc}{" "}
                            <span style={{ color: "#E85A00" }}>USDC</span>
                            <span className="text-black/40">/call</span>
                          </span>
                        </div>
                        <span
                          className="btn-cyber inline-flex items-center gap-1"
                          style={{ padding: "8px 14px", fontSize: "0.6rem" }}
                        >
                          Run job <ArrowRight size={10} />
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
      </section>
    </>
  );
}
