"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { ArrowRight, X, Zap, Loader2 } from "lucide-react";
import NavMenu from "../components/NavMenu";

const GRID = "rgba(0,0,0,0.12)";
const SCREEN_NAME = "agent_hub1";
const TIMEOUT_MS = 12000;

type Twttr = {
  widgets?: { load: (el?: HTMLElement | null) => void };
};

export default function TwitterPage() {
  const feedRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const triggerLoad = () => {
    (window as Window & { twttr?: Twttr }).twttr?.widgets?.load(
      feedRef.current,
    );
  };

  // Watch for Twitter injecting the <iframe>
  useEffect(() => {
    const container = feedRef.current;
    if (!container) return;
    const observer = new MutationObserver(() => {
      if (container.querySelector("iframe")) {
        setLoaded(true);
        observer.disconnect();
      }
    });
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Timeout fallback
  useEffect(() => {
    if (loaded) return;
    const t = setTimeout(() => setError(true), TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [loaded]);

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
      {/* Top label bar */}
      <div
        className="flex items-center gap-3 px-6 md:px-10 py-4"
        style={{ borderBottom: `1px solid ${GRID}` }}
      >
        <div className="w-2 h-2" style={{ background: "#E85A00" }} />
        <span className="text-xs font-semibold tracking-widest uppercase text-black/50">
          Community
        </span>
        <div className="flex-1" />
        <div
          className="hidden md:block"
          style={{
            fontFamily: "var(--font-bebas-neue), sans-serif",
            fontSize: "clamp(20px, 2.4vw, 28px)",
            color: "#0C0C0C",
            lineHeight: 1,
            letterSpacing: "0.04em",
          }}
        >
          @agent_hub1 on X
        </div>
      </div>
      {/* Hero */}
      <section
        className="relative px-6 md:px-10 py-12 md:py-20 flex flex-col md:flex-row items-start gap-10"
        style={{ borderBottom: `1px solid ${GRID}` }}
      >
        <div className="md:w-[55%]">
          <h1
            className="leading-none uppercase text-black mb-6 select-none"
            style={{
              fontFamily: "var(--font-bebas-neue), sans-serif",
              fontSize: "clamp(56px, 9vw, 128px)",
              letterSpacing: "-0.01em",
              lineHeight: 0.92,
            }}
          >
            What people
            <br />
            are <span className="text-[#E85A00]">saying</span>
          </h1>
          <p className="text-base md:text-lg text-black/65 leading-relaxed max-w-xl">
            The latest from{" "}
            <span className="font-semibold text-black">@agent_hub1</span> on X —
            updates, integrations, and community highlights.
          </p>
        </div>

        {/* Stat cards */}
        <div className="md:flex-1 grid grid-cols-2 gap-4 w-full md:w-auto">
          {[
            {
              num: "01",
              label: "Live feed",
              desc: "Directly embedded from X, always up to date.",
            },
            {
              num: "02",
              label: "No API key",
              desc: "Powered by the free Twitter widget — zero setup.",
            },
            {
              num: "03",
              label: "Community",
              desc: "Share your experience, tag us on X.",
            },
            {
              num: "04",
              label: "Open source",
              desc: "AgentHub is built in public — follow along.",
            },
          ].map((card) => (
            <div
              key={card.num}
              className="p-5 flex flex-col gap-2"
              style={{ border: `1px solid ${GRID}` }}
            >
              <div
                className="text-3xl font-bold text-black/10"
                style={{ fontFamily: "var(--font-bebas-neue), sans-serif" }}
              >
                {card.num}
              </div>
              <div className="text-sm font-bold uppercase tracking-wider text-black">
                {card.label}
              </div>
              <div className="text-[11px] text-black/50 leading-relaxed">
                {card.desc}
              </div>
            </div>
          ))}
        </div>
      </section>
      {/* Feed section */}

      <section style={{ borderBottom: `1px solid ${GRID}` }}>
        <div
          className="flex items-center gap-3 px-6 md:px-10 py-4"
          style={{ borderBottom: `1px solid ${GRID}` }}
        >
          <div className="w-2 h-2" style={{ background: "#E85A00" }} />
          <span className="text-xs font-semibold tracking-widest uppercase text-black/50">
            Latest posts
          </span>
        </div>

        <div className="flex flex-col md:flex-row">
          {/* Left: description */}
          <div
            className="md:w-[30%] shrink-0 px-6 md:px-10 py-8 md:py-12"
            style={{ borderRight: `1px solid ${GRID}` }}
          >
            <h2
              className="uppercase mb-3"
              style={{
                fontFamily: "var(--font-bebas-neue), sans-serif",
                fontSize: "clamp(32px, 4vw, 56px)",
                lineHeight: 0.95,
                color: "#0C0C0C",
              }}
            >
              @agent_hub1
            </h2>
            <p className="text-sm text-black/55 leading-relaxed max-w-xs mb-6">
              Follow us on X to stay up to date with new agents, protocol
              updates, and community spotlights.
            </p>
            <a
              href="https://x.com/agent_hub1"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-xs font-semibold tracking-widest uppercase text-[#E85A00] hover:opacity-70 transition-opacity"
            >
              Open on X <ArrowRight size={12} />
            </a>
          </div>

          {/* Right: embed */}
          <div className="flex-1 px-6 md:px-10 py-6 md:py-8">
            <div
              className="relative overflow-hidden min-h-[600px]"
              style={{ border: `1px solid ${GRID}` }}
            >
              {/* Loading state */}
              {!loaded && !error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
                  <Loader2
                    size={24}
                    className="animate-spin"
                    style={{ color: "#E85A00" }}
                  />
                  <span className="text-xs font-semibold tracking-widest uppercase text-black/30">
                    Loading feed…
                  </span>
                </div>
              )}

              {/* Error / fallback state */}
              {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
                  <X size={28} className="text-black/20" />
                  <p className="text-sm text-black/50 leading-relaxed max-w-xs">
                    The X embed could not load — usually caused by an ad-blocker
                    or browser privacy settings.
                  </p>
                  <a
                    href="https://x.com/agent_hub1"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold tracking-widest uppercase text-white"
                    style={{ background: "#E85A00" }}
                  >
                    View @agent_hub1 on X <ArrowRight size={12} />
                  </a>
                  <button
                    onClick={() => {
                      setError(false);
                      setLoaded(false);
                      setTimeout(triggerLoad, 100);
                    }}
                    className="text-xs text-black/30 underline hover:text-black/60 transition-colors"
                  >
                    Try again
                  </button>
                </div>
              )}

              {/* Twitter widget anchor — widgets.js replaces this with an iframe */}
              <div ref={feedRef} className="w-full">
                <a
                  className="twitter-timeline"
                  href={`https://twitter.com/${SCREEN_NAME}?ref_src=twsrc%5Etfw`}
                  data-height="600"
                  data-theme="light"
                  data-chrome="noheader nofooter noborders noscrollbar"
                  data-dnt="true"
                  data-lang="en"
                >
                  Tweets by {SCREEN_NAME}
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Script
        src="https://platform.twitter.com/widgets.js"
        strategy="afterInteractive"
        onLoad={triggerLoad}
        onError={() => setError(true)}
      />
      {/* Dark CTA */}
      <section
        className="relative overflow-hidden flex flex-col md:flex-row items-stretch"
        style={{ borderBottom: `1px solid ${GRID}` }}
      >
        <div
          className="flex-1 px-6 md:px-10 py-12 md:py-16"
          style={{ background: "#0C0C0C" }}
        >
          <div className="flex items-center gap-2 mb-6">
            <div className="w-2 h-2" style={{ background: "#E85A00" }} />
            <span className="text-xs font-semibold tracking-widest uppercase text-white/40">
              Join the conversation
            </span>
          </div>
          <h2
            className="uppercase text-white mb-6"
            style={{
              fontFamily: "var(--font-bebas-neue), sans-serif",
              fontSize: "clamp(36px, 5vw, 72px)",
              lineHeight: 0.95,
              letterSpacing: "-0.01em",
            }}
          >
            Share your
            <br />
            experience
          </h2>
          <p className="text-sm text-white/50 leading-relaxed max-w-md mb-8">
            Built something with AgentHub? Tag{" "}
            <span className="text-white/80">@agent_hub1</span> and we'll retweet
            your project to the community.
          </p>
          <div className="flex flex-col sm:flex-row gap-6">
            <a
              href="https://twitter.com/intent/tweet?text=Just%20discovered%20%40agent_hub1%20%E2%80%94%20a%20curated%20marketplace%20for%20AI%20agents%20with%20pay-per-call%20USDC%20payments!%20%F0%9F%94%A5"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-cyber btn-cyber-on-dark"
            >
              Tweet about us <ArrowRight size={13} />
            </a>
            <a href="/agents" className="btn-cyber-inverse">
              Browse Agents
            </a>
          </div>
        </div>

        <div
          className="hidden md:flex flex-col items-center justify-center w-72 shrink-0 gap-6 px-10"
          style={{
            background: "#141414",
            borderLeft: `1px solid rgba(255,255,255,0.07)`,
          }}
        >
          <X size={48} color="#E85A00" />
          <div className="text-center">
            <div
              className="text-3xl mb-1"
              style={{
                fontFamily: "var(--font-bebas-neue), sans-serif",
                color: "#fff",
              }}
            >
              Follow Along
            </div>
            <div className="text-[10px] uppercase tracking-widest text-white/30">
              @agent_hub1 on X
            </div>
          </div>
        </div>
      </section>
      {/* Footer */}
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
        <div className="text-[10px] text-black/30 uppercase tracking-widest">
          © 2026 AgentHub
        </div>
      </footer>
    </div>
  );
}
