"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  Copy,
  ShieldAlert,
  Wallet,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Alert, AlertKind } from "@/lib/services/alerts";

const ICONS: Record<AlertKind, typeof Bell> = {
  MISMATCH: ShieldAlert,
  MISSING: AlertTriangle,
  DUPLICATE_SCAN: Copy,
  DELAYED: Clock3,
  PENDING_PAYMENT: Wallet,
};

const KIND_LABELS: Record<AlertKind, string> = {
  MISMATCH: "Mismatch",
  MISSING: "Missing",
  DUPLICATE_SCAN: "Duplicate scan",
  DELAYED: "Delayed",
  PENDING_PAYMENT: "Payment due",
};

/**
 * The bell. Everything in it is derived from live data and links to the record
 * it is about, so an alert is a way into the work rather than a message to be
 * dismissed — and it stops appearing on its own once the problem is fixed.
 */
export function NotificationBell({ feed }: { feed: { alerts: Alert[]; total: number } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  const previous = useRef(feed.total);

  // A count that just went up gets one pulse — enough to catch an eye that is
  // looking elsewhere, not enough to nag.
  useEffect(() => {
    if (feed.total > previous.current) {
      setPulse(true);
      const timer = setTimeout(() => setPulse(false), 1800);
      previous.current = feed.total;
      return () => clearTimeout(timer);
    }
    previous.current = feed.total;
  }, [feed.total]);

  const badge = feed.total > 99 ? "99+" : String(feed.total);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative", pulse && "animate-pulse-ring rounded-full")}
          aria-label={`Notifications${feed.total ? `, ${feed.total} needing attention` : ""}`}
        >
          <Bell className={cn(pulse && "animate-shake")} />
          {feed.total > 0 ? (
            <Badge
              tone="danger"
              className="animate-pop absolute -right-0.5 -top-0.5 h-4 min-w-4 justify-center px-1 text-[10px]"
            >
              {badge}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <p className="text-sm font-semibold">Needs attention</p>
          <span className="text-xs text-muted-foreground">{feed.total}</span>
        </div>

        {feed.alerts.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
            <CheckCircle2 className="size-7 text-success" />
            <p className="text-sm font-medium">All clear</p>
            <p className="text-xs text-muted-foreground">
              Nothing mismatched, missing, late or unpaid.
            </p>
          </div>
        ) : (
          <ul className="stagger max-h-[26rem] overflow-y-auto scrollbar-thin">
            {feed.alerts.map((alert) => {
              const Icon = ICONS[alert.kind];
              return (
                <li key={alert.id} className="border-b border-border last:border-0">
                  <Link
                    href={alert.href}
                    onClick={() => setOpen(false)}
                    className="flex gap-2.5 px-4 py-3 text-left transition-colors hover:bg-accent"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg",
                        alert.tone === "danger"
                          ? "bg-destructive/12 text-destructive"
                          : "bg-warning/20 text-warning-foreground",
                      )}
                    >
                      <Icon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{alert.title}</span>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {alert.detail}
                      </span>
                      <span className="mt-1 inline-block text-[10px] uppercase tracking-wide text-muted-foreground">
                        {KIND_LABELS[alert.kind]}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.refresh()}
            className="text-xs"
          >
            Refresh
          </Button>
          <Button asChild variant="ghost" size="sm" className="text-xs">
            <Link href="/mismatch" onClick={() => setOpen(false)}>
              Open mismatch centre
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
