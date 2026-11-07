"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface CountUpProps {
  value: number;
  /** Rendered form — currency, compact, whatever the caller needs. */
  format?: (value: number) => string;
  durationMs?: number;
  className?: string;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Counts from the last value it showed to the new one.
 *
 * It animates on updates as well as on mount, so when a scan changes a figure
 * the number visibly moves rather than silently swapping — that movement is
 * the feedback that the action landed. The server-rendered pass shows the real
 * value so there is no flash of zero and nothing to hydrate around.
 */
export function CountUp({ value, format, durationMs = 650, className }: CountUpProps) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef<number | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    // First run after hydration counts up from zero, which is the entrance
    // animation; every run after that counts from whatever was on screen, so a
    // figure that changes under the reader visibly moves to its new value.
    const from = mounted.current ? fromRef.current : 0;
    mounted.current = true;
    const to = value;
    fromRef.current = value;

    if (from === to) return;
    if (prefersReducedMotion()) {
      setDisplay(to);
      return;
    }

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Quartic ease-out: quick off the mark, gentle landing.
      const eased = 1 - Math.pow(1 - t, 4);
      setDisplay(from + (to - from) * eased);
      if (t < 1) frameRef.current = requestAnimationFrame(step);
    };

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [value, durationMs]);

  const shown = format ? format(display) : Math.round(display).toLocaleString("en-IN");

  return (
    <span className={cn("tabular", className)} suppressHydrationWarning>
      {shown}
    </span>
  );
}
