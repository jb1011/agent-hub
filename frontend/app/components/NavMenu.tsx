"use client";

import { useState } from "react";
import { Zap, Menu, X } from "lucide-react";

const GRID = "rgba(0,0,0,0.12)";

const navLinks = [
  { label: "Agents", href: "/agents" },
  { label: "Feedback", href: "/feedback" },
  { label: "FAQ", href: "/faq" },
];

export default function NavMenu() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <nav
        className="sticky top-0 z-50 flex items-center px-6 md:px-10 h-14"
        style={{ background: "#E8E8E4", borderBottom: `1px solid ${GRID}` }}
      >
        {/* Logo */}
        <a href="/" className="flex items-center gap-2 flex-1">
          <div
            className="w-7 h-7 flex items-center justify-center"
            style={{ background: "#E85A00" }}
          >
            <Zap size={14} className="text-white fill-white" />
          </div>
          <span
            className="text-sm font-semibold tracking-widest uppercase"
            style={{ letterSpacing: "0.18em" }}
          >
            AgentHub
          </span>
        </a>

        {/* Desktop nav links — absolutely centered */}
        <div className="hidden md:flex absolute left-1/2 -translate-x-1/2 items-center gap-8 text-xs font-medium tracking-wider uppercase text-black/60">
          {navLinks.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="hover:text-black transition-colors"
            >
              {item.label}
            </a>
          ))}
        </div>

        {/* Desktop CTA */}
        {/* <div className="hidden md:flex items-center gap-3">
          <a
            href="#"
            className="text-xs font-medium tracking-wider uppercase text-black/60 hover:text-black transition-colors"
          >
            Sign In
          </a>
          <a href="#" className="btn-cyber">
            Get Started
          </a>
        </div> */}
        <div className="flex-1" />

        {/* Mobile toggle */}
        <button
          className="md:hidden cursor-pointer"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      {/* Mobile menu */}
      {menuOpen && (
        <div
          className="md:hidden px-6 py-6 flex flex-col gap-4 text-sm font-medium uppercase tracking-widest"
          style={{ borderBottom: `1px solid ${GRID}`, background: "#E8E8E4" }}
        >
          {navLinks.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="text-black/70 hover:text-black"
            >
              {item.label}
            </a>
          ))}
          {/* <a href="#" className="btn-cyber">
            Get Started
          </a> */}
        </div>
      )}
    </>
  );
}
