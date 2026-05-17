"use client";

import { useState } from "react";
import { ArrowRight, Zap } from "lucide-react";
import NavMenu from "../components/NavMenu";

const GRID = "rgba(0,0,0,0.12)";

const SETUP_TIMES = [
  "Less than 30 minutes",
  "30 minutes – 1 hour",
  "1 – 3 hours",
  "3 – 8 hours",
  "More than a day",
];

function StarRating({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          className="text-2xl transition-colors leading-none"
          style={{
            color:
              star <= (hovered || value) ? "#E85A00" : "rgba(0,0,0,0.2)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px",
          }}
          aria-label={`${star} star${star > 1 ? "s" : ""}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

type Status = "idle" | "loading" | "success" | "error";

const inputClass =
  "w-full bg-transparent border border-black/15 px-4 py-3 text-sm placeholder:text-black/30 focus:outline-none focus:border-[#E85A00] transition-colors resize-none";

export default function FeedbackPage() {
  const [form, setForm] = useState({
    email: "",
    name: "",
    company: "",
    agentPurpose: "",
    hadIssues: "",
    setupTime: "",
    rating: 0,
    other: "",
  });
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  function set(field: keyof typeof form, value: string | number) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const requiredFilled =
    form.email &&
    form.name &&
    form.company &&
    form.agentPurpose &&
    form.hadIssues;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!requiredFilled) return;

    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Something went wrong");
      }

      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
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

      {/* Page header */}
      <div
        className="flex items-center gap-3 px-6 md:px-10 py-4"
        style={{ borderBottom: `1px solid ${GRID}` }}
      >
        <div className="w-2 h-2" style={{ background: "#E85A00" }} />
        <span className="text-xs font-semibold tracking-widest uppercase text-black/50">
          Feedback
        </span>
      </div>

      <div className="flex flex-col md:flex-row" style={{ minHeight: "calc(100vh - 112px)" }}>
        {/* Left: intro */}
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
              Tell Us
              <br />
              What You
              <br />
              Think
            </h1>
            <p className="text-sm text-black/60 leading-relaxed max-w-xs mb-8">
              Share your experience setting up your agent on SkillHub. Your
              feedback helps us make the platform better for everyone.
            </p>
            <div className="flex items-center gap-2">
              <div
                className="w-5 h-5 flex items-center justify-center"
                style={{ background: "#E85A00" }}
              >
                <Zap size={10} className="text-white fill-white" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-black/40">
                SkillHub · Agent Marketplace
              </span>
            </div>
          </div>

          {/* Fine print */}
          <p className="mt-10 text-[10px] text-black/30 uppercase tracking-widest leading-relaxed">
            Fields marked with <span className="text-[#E85A00]">*</span> are
            required. We will only use your email to follow up if needed.
          </p>
        </div>

        {/* Right: form */}
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
                Feedback Sent!
              </h2>
              <p className="text-sm text-black/60 leading-relaxed">
                Thank you for taking the time. We read every submission and
                use it to improve SkillHub.
              </p>
              <a href="/" className="btn-cyber">
                Back to Home <ArrowRight size={13} />
              </a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-8 max-w-2xl">
              {/* Basic info row */}
              <div>
                <div className="text-[10px] uppercase tracking-widest font-bold text-black/40 mb-4">
                  Contact Info
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                      Email <span className="text-[#E85A00]">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="you@company.com"
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                      Name <span className="text-[#E85A00]">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Your full name"
                      value={form.name}
                      onChange={(e) => set("name", e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>

              {/* Company / agent */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                  Company / Agent Name <span className="text-[#E85A00]">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Acme Corp or my-weather-agent"
                  value={form.company}
                  onChange={(e) => set("company", e.target.value)}
                  className={inputClass}
                />
              </div>

              {/* Agent purpose */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                  What is the purpose of your agent?{" "}
                  <span className="text-[#E85A00]">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Describe what your agent does and the problem it solves…"
                  value={form.agentPurpose}
                  onChange={(e) => set("agentPurpose", e.target.value)}
                  className={inputClass}
                />
              </div>

              {/* Issues */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                  Did you have any issues setting up your agent?{" "}
                  <span className="text-[#E85A00]">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder={'Describe any blockers or difficulties you encountered. If none, write "No issues".'}
                  value={form.hadIssues}
                  onChange={(e) => set("hadIssues", e.target.value)}
                  className={inputClass}
                />
              </div>

              {/* Setup time */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                  How long did the setup take you?
                </label>
                <div className="flex flex-wrap gap-2">
                  {SETUP_TIMES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() =>
                        set("setupTime", form.setupTime === t ? "" : t)
                      }
                      className="text-xs font-medium uppercase tracking-wider px-3 py-2 transition-colors"
                      style={{
                        border: `1px solid ${form.setupTime === t ? "#E85A00" : GRID}`,
                        background:
                          form.setupTime === t
                            ? "rgba(232,90,0,0.08)"
                            : "transparent",
                        color:
                          form.setupTime === t ? "#E85A00" : "rgba(0,0,0,0.5)",
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Rating */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                  How would you rate your experience?
                </label>
                <StarRating
                  value={form.rating}
                  onChange={(v) => set("rating", v)}
                />
                {form.rating > 0 && (
                  <span className="text-[10px] text-black/40 uppercase tracking-wider">
                    {
                      [
                        "",
                        "Poor",
                        "Fair",
                        "Good",
                        "Great",
                        "Excellent",
                      ][form.rating]
                    }
                  </span>
                )}
              </div>

              {/* Other */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-black/50">
                  Anything else you want to share?
                </label>
                <textarea
                  rows={3}
                  placeholder="Additional thoughts, feature requests, or suggestions…"
                  value={form.other}
                  onChange={(e) => set("other", e.target.value)}
                  className={inputClass}
                />
              </div>

              {/* Error */}
              {status === "error" && (
                <p className="text-xs text-red-600 font-medium">{errorMsg}</p>
              )}

              {/* Submit */}
              <div>
                <button
                  type="submit"
                  disabled={!requiredFilled || status === "loading"}
                  className="btn-cyber disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {status === "loading" ? "Sending…" : "Send Feedback"}
                  {status !== "loading" && <ArrowRight size={13} />}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Footer divider */}
      <div style={{ borderTop: `1px solid ${GRID}` }} />
    </div>
  );
}
