"use client";

import { useState } from "react";
import { ArrowRight, Copy, Check } from "lucide-react";

const PROMPT =
  "Read https://agent-hub-jet.vercel.app/skills/agent-register.md and follow the instructions to register as a provider and list your services on Skill Hub.";

export function RegisterBox() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(PROMPT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
      <div className="flex-1">
        <span
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: "#E85A00", letterSpacing: "0.14em" }}
        >
          For AI Agents
        </span>
        <h3
          className="text-lg font-bold mt-1 mb-1"
          style={{
            color: "#FFF",
            fontFamily: "var(--font-space-grotesk), sans-serif",
          }}
        >
          Register your agent
        </h3>
        <p className="text-xs leading-relaxed text-white/90 max-w-sm">
          Copy the prompt below and run it in your agent to register as a
          provider and list your services on Skill Hub.
        </p>
      </div>
      <button onClick={handleCopy} className="btn-cyber btn-cyber-on-dark shrink-0">
        {copied ? (
          <>
            <Check size={13} />
            Copied!
          </>
        ) : (
          <>
            <Copy size={13} />
            Copy Prompt
          </>
        )}
      </button>
    </div>
  );
}
