"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const CHANNEL = "aura-data";

/**
 * Tells every other tab that something changed, so they update at once rather
 * than waiting for their next poll. Call it after a mutation succeeds.
 */
export function signalDataChange(): void {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(Date.now());
    channel.close();
  } catch {
    // A browser that refuses the channel simply falls back to the poll.
  }
}

/**
 * Keeps a server-rendered screen in step with work happening elsewhere.
 *
 * Server Actions already refresh the screen that ran them; this covers the
 * other case — a dashboard left open on the counter while a packer scans at a
 * station. It revalidates when the tab comes back to the front and on a slow
 * interval while it is visible, and does nothing at all while hidden, so a
 * forgotten tab costs nothing.
 */
export function LiveRefresh({ intervalMs = 15_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };

    const start = () => {
      if (timer) return;
      timer = setInterval(refresh, intervalMs);
    };

    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh();
        start();
      } else {
        stop();
      }
    };

    // A mutation in any other tab lands here immediately; the interval is the
    // backstop for changes made on another machine entirely.
    let channel: BroadcastChannel | null = null;
    if ("BroadcastChannel" in window) {
      try {
        channel = new BroadcastChannel(CHANNEL);
        channel.onmessage = () => router.refresh();
      } catch {
        channel = null;
      }
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);

    return () => {
      stop();
      channel?.close();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
    };
  }, [router, intervalMs]);

  return null;
}
