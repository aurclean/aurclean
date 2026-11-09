"use client";

import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";

/**
 * Shown in place of one section that failed or timed out, so a slow report or
 * chart never takes the rest of the screen down with it. Retry re-runs the
 * server render for this route.
 */
export function SectionError({ title, message }: { title: string; message?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-sm shadow-sm"
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <AlertTriangle className="size-4 text-destructive" aria-hidden />
        <span>
          <strong className="text-foreground">{title}</strong> couldn&apos;t be loaded.{" "}
          {message ?? "It may be slow right now."}
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        {pending ? "Retrying…" : "Retry"}
      </Button>
    </div>
  );
}
