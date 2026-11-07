import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { CountUp } from "@/components/shared/count-up";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  hint?: string;
  href?: string;
  tone?: "default" | "success" | "warning" | "danger" | "info";
  delta?: { value: number; label?: string };
  className?: string;
  /** Plain counts animate to their new figure; pre-formatted strings do not. */
  animate?: boolean;
}

const TONES = {
  default: "bg-primary/10 text-primary",
  success: "bg-success/12 text-success",
  warning: "bg-warning/18 text-warning-foreground",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-info/12 text-info",
} as const;

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  href,
  tone = "default",
  delta,
  className,
  animate = true,
}: StatCardProps) {
  const body = (
    <Card
      className={cn(
        "flex h-full items-start gap-3 p-4",
        href && "lift cursor-pointer hover:border-primary/40",
        className,
      )}
    >
      {Icon ? (
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            TONES[tone],
          )}
        >
          <Icon className="size-4.5" aria-hidden />
        </span>
      ) : null}
      <div className="min-w-0 space-y-0.5">
        <p className="line-clamp-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-2xl font-semibold tracking-tight numeric">
          {animate && typeof value === "number" ? <CountUp value={value} /> : value}
        </p>
        {delta ? (
          <p
            className={cn(
              "flex items-center gap-0.5 text-xs font-medium",
              delta.value >= 0 ? "text-success" : "text-destructive",
            )}
          >
            {delta.value >= 0 ? (
              <ArrowUpRight className="size-3" />
            ) : (
              <ArrowDownRight className="size-3" />
            )}
            {Math.abs(delta.value).toFixed(1)}%{delta.label ? ` ${delta.label}` : ""}
          </p>
        ) : null}
        {hint ? <p className="truncate text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </Card>
  );

  return href ? (
    <Link
      href={href}
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </Link>
  ) : (
    body
  );
}
