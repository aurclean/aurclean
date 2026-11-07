import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TimelineEntry {
  id: string;
  time: string;
  title: string;
  description?: string | null;
  meta?: string | null;
  tone?: "default" | "success" | "warning" | "danger" | "info";
  icon?: ReactNode;
}

const DOT_TONES = {
  default: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
} as const;

/** Vertical activity feed used for garment history, order history and audit. */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No activity recorded yet.
      </p>
    );
  }

  return (
    <ol className="relative space-y-0">
      {entries.map((entry, index) => (
        <li key={entry.id} className="relative flex gap-3 pb-5 last:pb-0">
          <div className="flex flex-col items-center">
            <span
              className={cn(
                "mt-1 size-2.5 shrink-0 rounded-full ring-4 ring-background",
                DOT_TONES[entry.tone ?? "default"],
              )}
              aria-hidden
            />
            {index < entries.length - 1 ? (
              <span className="mt-1 w-px flex-1 bg-border" aria-hidden />
            ) : null}
          </div>
          <div className="min-w-0 flex-1 -mt-0.5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-xs text-muted-foreground numeric">
                {entry.time}
              </span>
              <span className="text-sm font-medium">{entry.title}</span>
            </div>
            {entry.description ? (
              <p className="mt-0.5 text-sm text-muted-foreground">{entry.description}</p>
            ) : null}
            {entry.meta ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{entry.meta}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
