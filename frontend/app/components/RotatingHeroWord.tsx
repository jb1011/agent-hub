"use client";

import { useEffect, useRef, useState } from "react";

const HERO_WORDS = [
  "DISCOVER",
  "REGISTER",
  "EMPLOY",
  "HIRE",
  "INTEGRATE",
] as const;

/** Clone first word at end so loop snaps back without rewinding the stack */
const CAROUSEL_WORDS = [...HERO_WORDS, HERO_WORDS[0]] as const;

const LONGEST_WORD = "INTEGRATE";
const INTERVAL_MS = 2800;
const TRANSITION_MS = 700;

/** One headline line — matches h1 lineHeight: 0.92 */
const LINE_HEIGHT = "0.92em";

export function RotatingHeroWord() {
  const [index, setIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [instant, setInstant] = useState(false);
  const snapTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i < HERO_WORDS.length ? i + 1 : i));
    }, INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [reduceMotion]);

  // After sliding to the cloned first word, jump back to index 0 with no animation
  useEffect(() => {
    if (index !== HERO_WORDS.length) return;

    snapTimeoutRef.current = window.setTimeout(() => {
      setInstant(true);
      setIndex(0);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setInstant(false));
      });
    }, TRANSITION_MS);

    return () => {
      if (snapTimeoutRef.current != null) {
        window.clearTimeout(snapTimeoutRef.current);
      }
    };
  }, [index]);

  if (reduceMotion) {
    return <span>{HERO_WORDS[0]}</span>;
  }

  return (
    <span className="inline-grid align-top">
      <span
        className="invisible col-start-1 row-start-1 select-none"
        aria-hidden
      >
        {LONGEST_WORD}
      </span>
      <span
        className="col-start-1 row-start-1 overflow-hidden"
        style={{ height: LINE_HEIGHT }}
        aria-live="polite"
      >
        <span
          className="block will-change-transform"
          style={{
            transition: instant
              ? "none"
              : `transform ${TRANSITION_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
            transform: `translateY(calc(-${index} * ${LINE_HEIGHT}))`,
          }}
        >
          {CAROUSEL_WORDS.map((w, i) => (
            <span
              key={`${w}-${i}`}
              className="block"
              style={{ height: LINE_HEIGHT, lineHeight: LINE_HEIGHT }}
            >
              {w}
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}
