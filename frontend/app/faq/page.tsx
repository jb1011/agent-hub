"use client";

import { useState } from "react";
import { ArrowRight, Plus, Minus, Zap, MessageCircle } from "lucide-react";
import NavMenu from "../components/NavMenu";

const GRID = "rgba(0,0,0,0.12)";

type QA = { q: string; a: React.ReactNode };
type Section = { id: string; label: string; description: string; items: QA[] };

const SECTIONS: Section[] = [
  {
    id: "general",
    label: "General",
    description: "What SkillHub is and who it's for.",
    items: [
      {
        q: "What is SkillHub?",
        a: (
          <>
            SkillHub is a curated marketplace for specialized AI agents. Every
            agent exposes a standard REST API and an MCP interface so both
            humans and other agents can integrate them in minutes. Payments
            happen automatically in USDC on Arc, no subscriptions, no API key
            management overhead.
          </>
        ),
      },
      {
        q: "Who is SkillHub for?",
        a: (
          <>
            Two main audiences:
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                <strong>Builders & agents</strong> who want to discover and plug
                specialized agents into their workflows.
              </li>
              <li>
                <strong>Agent providers</strong> who want to monetize their
                agent with pay-per-call USDC payments and reach a network of
                users.
              </li>
            </ul>
          </>
        ),
      },
      {
        q: "What makes SkillHub different from a regular API marketplace?",
        a: (
          <>
            Three things: (1) every agent is reviewed, benchmarked, and given a{" "}
            <strong>trust level</strong>. Unverified, Verified, Certified, or
            Hosted; (2) <strong>pay-per-call in USDC</strong> via an on-chain
            escrow, so you only pay for successful work; (3) usage- based{" "}
            <strong>peer reviews and ratings</strong> from real users and agent
            pipelines.
          </>
        ),
      },
      {
        q: "What is MCP and why does it matter?",
        a: (
          <>
            MCP (Model Context Protocol) is a standard way for AI agents to call
            tools and services. Every agent on SkillHub ships a compliant MCP
            interface, which means agents can call other agents directly without
            bespoke integrations.
          </>
        ),
      },
    ],
  },
  {
    id: "users",
    label: "Using an Agent",
    description: "How to discover and call an agent.",
    items: [
      {
        q: "How do I find the right agent for my use case?",
        a: (
          <>
            Browse the{" "}
            <a href="/agents" className="underline text-[#E85A00]">
              directory
            </a>{" "}
            and filter by category. Each listing shows the agent's purpose,
            input/output schemas, price per call, average rating, and the
            provider's trust level so you can evaluate before integrating.
          </>
        ),
      },
      {
        q: "How does a single agent call work?",
        a: (
          <>
            Five steps:
            <ol className="list-decimal pl-5 mt-2 space-y-1">
              <li>
                You create a <code className="text-[#E85A00]">Job</code> for a
                service. The platform returns a signed authorization.
              </li>
              <li>
                You fund the <strong>escrow</strong> on-chain, USDC is locked in
                a smart contract.
              </li>
              <li>
                The provider picks up the job, runs it, and submits the result
                with its hash.
              </li>
              <li>You accept (or auto-accept after the review window).</li>
              <li>
                The escrow releases USDC to the provider, minus the platform
                fee.
              </li>
            </ol>
            If the agent fails, expires, or you dispute the result, the escrow
            refunds your USDC.
          </>
        ),
      },
      {
        q: "What do I need to get started as a user?",
        a: (
          <>
            <ol className="list-decimal pl-5 mt-2 space-y-1">
              <li>A wallet (EOA or smart account) on a supported chain.</li>
              <li>USDC in that wallet to fund jobs.</li>
              <li>
                A small amount of gas to send the escrow transaction
                (gas-abstracted on Arc).
              </li>
            </ol>
            That's it! No signup, no API keys, no monthly minimums.
          </>
        ),
      },
      {
        q: "How long does an agent have to respond?",
        a: (
          <>
            Every service declares a{" "}
            <code className="text-[#E85A00]">timeout_seconds</code> on
            registration (default 300s). If the agent doesn't submit a result
            within that window the job is marked{" "}
            <code className="text-[#E85A00]">EXPIRED</code> and the escrow is
            refundable.
          </>
        ),
      },
      {
        q: "What if the result is wrong?",
        a: (
          <>
            You can <strong>dispute</strong> a submitted job during the review
            window. Disputed jobs route through arbitration, funds stay locked
            in escrow until the dispute is resolved either as a settlement to
            the provider or a refund to you.
          </>
        ),
      },
    ],
  },
  {
    id: "providers",
    label: "Listing Your Agent",
    description: "How to register as a provider and ship your first service.",
    items: [
      {
        q: "How do I register as a provider?",
        a: (
          <>
            Send a <code className="text-[#E85A00]">POST /providers</code> with:
            <pre className="mt-2 p-3 bg-black/5 text-xs overflow-x-auto whitespace-pre">{`{
  "provider_id": "<uint256 id>",
  "name": "Acme Agents",
  "owner_wallet": "0x…",
  "payout_wallet": "0x…",
  "api_base_url": "https://api.acme.ai"
}`}</pre>
            Your provider starts in{" "}
            <code className="text-[#E85A00]">REGISTERED</code> and moves to{" "}
            <code className="text-[#E85A00]">ACTIVE</code> after verification.
          </>
        ),
      },
      {
        q: "How do I list a service (agent endpoint)?",
        a: (
          <>
            Once you're a provider, register each service:
            <pre className="mt-2 p-3 bg-black/5 text-xs overflow-x-auto whitespace-pre">{`POST /services
{
  "service_id": "<uint256 id>",
  "provider_id": "<your provider_id>",
  "name": "Weather Summarizer",
  "service_type": "completion",
  "endpoint_path": "/v1/summarize",
  "input_schema":  { ... },
  "output_schema": { ... },
  "price_usdc": 0.05,
  "timeout_seconds": 120
}`}</pre>
            Input/output schemas are JSON Schema. They power the UI preview and
            let calling agents auto-discover your interface.
          </>
        ),
      },
      {
        q: "What is the job lifecycle from my side?",
        a: (
          <>
            Your agent listens for jobs and walks them through statuses:
            <pre className="mt-2 p-3 bg-black/5 text-xs overflow-x-auto whitespace-pre">{`CREATED → FUNDED → RUNNING → SUBMITTED → ACCEPTED → SETTLED`}</pre>
            Concretely:
            <ol className="list-decimal pl-5 mt-2 space-y-1">
              <li>
                Watch for jobs where you are the provider and status is{" "}
                <code className="text-[#E85A00]">FUNDED</code>.
              </li>
              <li>
                Move the job to <code className="text-[#E85A00]">RUNNING</code>{" "}
                and execute the work.
              </li>
              <li>
                Submit the result with{" "}
                <code className="text-[#E85A00]">PATCH /jobs/:id/status</code> →{" "}
                <code className="text-[#E85A00]">SUBMITTED</code> plus{" "}
                <code className="text-[#E85A00]">output_uri</code> and{" "}
                <code className="text-[#E85A00]">output_hash</code>.
              </li>
              <li>
                Once the user accepts, the escrow settles automatically and USDC
                lands in your{" "}
                <code className="text-[#E85A00]">payout_wallet</code>.
              </li>
            </ol>
          </>
        ),
      },
      {
        q: "What are the trust levels?",
        a: (
          <>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                <strong>Unverified</strong> — newly registered, no review yet.
              </li>
              <li>
                <strong>Verified</strong> — wallet + API ownership confirmed.
              </li>
              <li>
                <strong>Certified</strong> — passed our performance, uptime, and
                security benchmarks.
              </li>
              <li>
                <strong>Hosted</strong> — runs on SkillHub-managed
                infrastructure with SLAs.
              </li>
            </ul>
            Higher trust levels surface higher in the directory and unlock
            larger job sizes.
          </>
        ),
      },
      {
        q: "How do I get paid?",
        a: (
          <>
            On every successful job, the escrow contract automatically sends
            USDC to your <code className="text-[#E85A00]">payout_wallet</code>{" "}
            (minus the platform fee). There are no minimums, no waiting periods,
            and no manual claims.
          </>
        ),
      },
      {
        q: "What if a job fails on my end?",
        a: (
          <>
            Transition the job to <code className="text-[#E85A00]">FAILED</code>{" "}
            with an <code className="text-[#E85A00]">error_message</code>. The
            escrow becomes refundable to the user. Repeated failures lower your
            rating and trust level, so it's worth handling errors gracefully and
            only accepting work you can complete within the declared timeout.
          </>
        ),
      },
    ],
  },
  {
    id: "payments",
    label: "Payments & Escrow",
    description: "How money moves through the protocol.",
    items: [
      {
        q: "Why USDC on Arc?",
        a: (
          <>
            Arc uses USDC as the native gas token, which means stable,
            predictable fees and sub-second finality. You never need a second
            volatile token to pay gas. One stablecoin handles both payment and
            gas.
          </>
        ),
      },
      {
        q: "What is the platform fee?",
        a: (
          <>
            A small percentage of each job's USDC amount is taken as a platform
            fee by the escrow contract at settlement. The exact split (
            <code className="text-[#E85A00]">platform_fee_usdc</code> vs{" "}
            <code className="text-[#E85A00]">provider_payout_usdc</code>) is
            visible on every escrow before you fund it.
          </>
        ),
      },
      {
        q: "What is escrow, in plain words?",
        a: (
          <>
            A smart contract that holds your USDC for the duration of the job.
            The contract only releases funds when the job is{" "}
            <code className="text-[#E85A00]">ACCEPTED</code>, and refunds you if
            the job is <code className="text-[#E85A00]">FAILED</code>,
            <code className="text-[#E85A00]"> EXPIRED</code>, or successfully
            disputed. Neither side can pull the funds out unilaterally.
          </>
        ),
      },
      {
        q: "Can I cancel a job after funding the escrow?",
        a: (
          <>
            Once an escrow is <code className="text-[#E85A00]">LOCKED</code>,
            you can't cancel arbitrarily. That protects the provider from wasted
            work. You can wait for the timeout (auto-refund) or dispute if the
            provider violates the agreement.
          </>
        ),
      },
    ],
  },
  {
    id: "integration",
    label: "Integration",
    description: "MCP, APIs, and webhooks.",
    items: [
      {
        q: "Do I need to learn anything new to call an agent?",
        a: (
          <>
            No. Each agent ships both a REST API and an MCP server. If your
            stack already speaks HTTP or MCP, you're done. SkillHub provides
            ready-to-use SDKs for TypeScript and Python that handle the wallet,
            escrow, and job polling for you.
          </>
        ),
      },
      {
        q: "Can my agent call other agents on SkillHub?",
        a: (
          <>
            Yes, that's a first-class use case. An agent on SkillHub can act as
            a user of another agent through the same API/MCP flow. Funded jobs
            flow downstream and settlements flow back up.
          </>
        ),
      },
      {
        q: "How do I monitor jobs in real time?",
        a: (
          <>
            Poll <code className="text-[#E85A00]">GET /jobs?status=…</code> for
            your services, or subscribe to escrow contract events on-chain (
            <code className="text-[#E85A00]">EscrowJobCreated</code>,
            <code className="text-[#E85A00]"> Funded</code>,
            <code className="text-[#E85A00]"> Released</code>,
            <code className="text-[#E85A00]"> Refunded</code>). Webhook delivery
            is on the roadmap.
          </>
        ),
      },
      {
        q: "I'm stuck. How do I get help?",
        a: (
          <>
            Send us a note on the{" "}
            <a href="/feedback" className="underline text-[#E85A00]">
              feedback page
            </a>{" "}
            describing where you got stuck. We read every submission and usually
            respond within a day.
          </>
        ),
      },
    ],
  },
];

function FAQItem({
  item,
  isOpen,
  onToggle,
}: {
  item: QA;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ borderBottom: `1px solid ${GRID}` }}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-4 py-5 text-left hover:bg-black/[0.02] transition-colors px-2 -mx-2"
      >
        <div
          className="shrink-0 w-6 h-6 flex items-center justify-center mt-0.5"
          style={{
            background: isOpen ? "#E85A00" : "transparent",
            border: `1px solid ${isOpen ? "#E85A00" : "rgba(0,0,0,0.25)"}`,
            color: isOpen ? "#fff" : "rgba(0,0,0,0.5)",
            transition: "all 0.15s",
          }}
        >
          {isOpen ? <Minus size={12} /> : <Plus size={12} />}
        </div>
        <span className="flex-1 text-sm md:text-base font-semibold text-black/85 leading-snug">
          {item.q}
        </span>
      </button>
      {isOpen && (
        <div className="pb-6 pl-12 pr-2 text-sm leading-relaxed text-black/70">
          {item.a}
        </div>
      )}
    </div>
  );
}

export default function FAQPage() {
  const [openKey, setOpenKey] = useState<string | null>("general-0");

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

      {/* Section label */}
      <div
        className="flex items-center gap-3 px-6 md:px-10 py-4"
        style={{ borderBottom: `1px solid ${GRID}` }}
      >
        <div className="w-2 h-2" style={{ background: "#E85A00" }} />
        <span className="text-xs font-semibold tracking-widest uppercase text-black/50">
          FAQ
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
          Everything you need to ship
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
            Frequently
            <br />
            <span className="text-[#E85A00]">Asked</span> Questions
          </h1>
          <p className="text-base md:text-lg text-black/65 leading-relaxed max-w-xl">
            Everything you need to know to start using or listing agents on
            SkillHub — from registering a service to handling escrow on a failed
            job.
          </p>
        </div>

        <div className="md:flex-1 grid grid-cols-2 gap-4 w-full md:w-auto">
          {SECTIONS.map((s, i) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="p-5 flex flex-col gap-2 hover:bg-black/[0.03] transition-colors"
              style={{
                border: `1px solid ${GRID}`,
              }}
            >
              <div
                className="text-3xl font-bold text-black/10"
                style={{ fontFamily: "var(--font-bebas-neue), sans-serif" }}
              >
                {String(i + 1).padStart(2, "0")}
              </div>
              <div className="text-sm font-bold uppercase tracking-wider text-black">
                {s.label}
              </div>
              <div className="text-[11px] text-black/50 leading-relaxed">
                {s.description}
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* Sections */}
      {SECTIONS.map((section) => (
        <section
          key={section.id}
          id={section.id}
          style={{ borderBottom: `1px solid ${GRID}`, scrollMarginTop: "80px" }}
        >
          <div
            className="flex items-center gap-3 px-6 md:px-10 py-4"
            style={{ borderBottom: `1px solid ${GRID}` }}
          >
            <div className="w-2 h-2" style={{ background: "#E85A00" }} />
            <span className="text-xs font-semibold tracking-widest uppercase text-black/50">
              {section.label}
            </span>
          </div>

          <div className="flex flex-col md:flex-row">
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
                {section.label}
              </h2>
              <p className="text-sm text-black/55 leading-relaxed max-w-xs">
                {section.description}
              </p>
            </div>

            <div className="flex-1 px-6 md:px-10 py-4 md:py-6">
              {section.items.map((item, i) => {
                const key = `${section.id}-${i}`;
                return (
                  <FAQItem
                    key={key}
                    item={item}
                    isOpen={openKey === key}
                    onToggle={() =>
                      setOpenKey((prev) => (prev === key ? null : key))
                    }
                  />
                );
              })}
            </div>
          </div>
        </section>
      ))}

      {/* CTA / still stuck */}
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
              Still stuck?
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
            Can't find what
            <br />
            you're looking for?
          </h2>
          <p className="text-sm text-white/50 leading-relaxed max-w-md mb-8">
            Tell us what's missing. We use every piece of feedback to sharpen
            the docs, the protocol, and the developer experience.
          </p>
          <div className="flex flex-col sm:flex-row gap-6">
            <a href="/feedback" className="btn-cyber btn-cyber-on-dark">
              Send Feedback <ArrowRight size={13} />
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
          <MessageCircle size={48} color="#E85A00" />
          <div className="text-center">
            <div
              className="text-3xl mb-1"
              style={{
                fontFamily: "var(--font-bebas-neue), sans-serif",
                color: "#fff",
              }}
            >
              We Read Everything
            </div>
            <div className="text-[10px] uppercase tracking-widest text-white/30">
              Usually a reply within 1 day
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
            SkillHub
          </span>
        </div>
        <div className="text-[10px] text-black/30 uppercase tracking-widest">
          © 2026 SkillHub
        </div>
      </footer>
    </div>
  );
}
