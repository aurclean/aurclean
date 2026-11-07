"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  PlayCircle,
  RotateCcw,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { signalDataChange } from "@/components/shared/live-refresh";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Scanner } from "@/components/shared/scanner";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import {
  bulkAdvanceAction,
  scanForStageAction,
} from "@/app/(app)/garments/actions";

export interface QueueItem {
  taskId: string;
  garmentId: string;
  garmentCode: string;
  orderNumber: string;
  orderId: string;
  customerName: string;
  typeName: string;
  serviceName: string;
  taskStatus: string;
  garmentStatus: string;
  dueAt: string;
  isDelayed: boolean;
  priority: string;
}

interface WorkstationProps {
  stage: string;
  stageLabel: string;
  items: QueueItem[];
  outcomes: {
    value: string;
    label: string;
    tone: "default" | "success" | "destructive" | "warning";
  }[];
  canOperate: boolean;
  /** Garments queued for this stage that are still finishing an earlier one. */
  waitingUpstream?: number;
}

const OUTCOME_ICON: Record<string, typeof CheckCircle2> = {
  IN_PROGRESS: PlayCircle,
  COMPLETED: CheckCircle2,
  PASSED: CheckCircle2,
  FAILED: XCircle,
  REWASH: RotateCcw,
  REWORK: RotateCcw,
};

export function Workstation({
  stage,
  stageLabel,
  items,
  outcomes,
  canOperate,
  waitingUpstream = 0,
}: WorkstationProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [alert, setAlert] = useState<string | null>(null);

  const selectedItems = useMemo(
    () => items.filter((item) => selected.has(item.garmentId)),
    [items, selected],
  );

  const toggle = (garmentId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(garmentId)) next.delete(garmentId);
      else next.add(garmentId);
      return next;
    });
  };

  const handleScan = async (code: string) => {
    const result = await scanForStageAction(code, stage);
    if (!result.ok) {
      setAlert(result.error);
      toast.error(result.error);
      return;
    }

    // The same tag read twice into one batch is the operator putting one piece
    // through as two.
    if (selected.has(result.data.id)) {
      const message = `${result.data.garmentCode} is already in this batch — scanned twice.`;
      setAlert(message);
      toast.error(message);
      return;
    }

    setSelected((current) => new Set(current).add(result.data.id));

    // A stray piece is caught while it is still in the operator's hand: the
    // banner stays up until the next clean scan, a toast alone is too easy to
    // miss on a busy floor.
    if (result.data.mismatchAlert) {
      setAlert(result.data.mismatchAlert);
      toast.error(result.data.mismatchAlert);
      return;
    }

    setAlert(null);
    toast.success(
      `${result.data.garmentCode} · ${result.data.typeName} · ${result.data.categoryLabel} (${result.data.orderNumber})`,
    );
  };

  const run = (outcome: string) => {
    if (selectedItems.length === 0) {
      toast.error("Scan or select at least one garment");
      return;
    }

    startTransition(async () => {
      const result = await bulkAdvanceAction({
        garmentIds: selectedItems.map((item) => item.garmentId),
        stage,
        outcome,
        note: note || undefined,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      if (result.data.succeeded > 0) {
        toast.success(
          `${result.data.succeeded} garment${result.data.succeeded === 1 ? "" : "s"} updated`,
        );
      }
      if (result.data.failed.length > 0) {
        toast.error(
          `${result.data.failed.length} could not be updated: ${result.data.failed[0].error}`,
        );
      }

      setAlert(null);
      setSelected(new Set());
      setNote("");
      signalDataChange();
      router.refresh();
    });
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-2">
        {canOperate ? (
          <Card>
            <CardHeader>
              <CardTitle>Scan into {stageLabel}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Scanner
                onScan={handleScan}
                placeholder="Scan garment tag (TR-1042)…"
                disabled={isPending}
              />

              {alert ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2.5 text-sm"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-destructive">Mismatch</p>
                    <p className="text-muted-foreground">{alert}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAlert(null)}
                    className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Dismiss
                  </button>
                </div>
              ) : null}

              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Optional note for this action"
              />

              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-sm font-medium">
                  {selectedItems.length} garment
                  {selectedItems.length === 1 ? "" : "s"} selected
                </p>
                {selectedItems.length > 0 ? (
                  <p className="mt-1 line-clamp-2 font-mono text-xs text-muted-foreground">
                    {selectedItems.map((item) => item.garmentCode).join(", ")}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-2">
                {outcomes.map((outcome) => {
                  const Icon = OUTCOME_ICON[outcome.value] ?? CheckCircle2;
                  return (
                    <Button
                      key={outcome.value}
                      size="xl"
                      variant={
                        outcome.tone === "destructive"
                          ? "destructive"
                          : outcome.tone === "success"
                            ? "success"
                            : outcome.tone === "warning"
                              ? "warning"
                              : "outline"
                      }
                      loading={isPending}
                      onClick={() => run(outcome.value)}
                    >
                      <Icon /> {outcome.label}
                    </Button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              You can view this queue but your role cannot operate this station.
            </CardContent>
          </Card>
        )}
      </div>

      <div className="lg:col-span-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle>Queue ({items.length})</CardTitle>
              {waitingUpstream > 0 ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {waitingUpstream} more still finishing an earlier station
                </p>
              ) : null}
            </div>
            {canOperate && items.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSelected((current) =>
                    current.size === items.length
                      ? new Set()
                      : new Set(items.map((item) => item.garmentId)),
                  )
                }
              >
                {selected.size === items.length ? "Clear all" : "Select all"}
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <EmptyState
                title="Queue is clear"
                description={
                  waitingUpstream > 0
                    ? `${waitingUpstream} garments are routed here but are still finishing an earlier station.`
                    : `Nothing is waiting at ${stageLabel.toLowerCase()} right now.`
                }
              />
            ) : (
              <ul className="space-y-1.5">
                {items.map((item) => {
                  const isSelected = selected.has(item.garmentId);
                  return (
                    <li key={item.taskId}>
                      <div
                        className={cn(
                          "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-muted/40",
                        )}
                      >
                        {canOperate ? (
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggle(item.garmentId)}
                            aria-label={`Select ${item.garmentCode}`}
                          />
                        ) : null}

                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => canOperate && toggle(item.garmentId)}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-semibold">
                              {item.garmentCode}
                            </span>
                            <span className="truncate text-sm">
                              {item.typeName}
                            </span>
                            <StatusBadge status={item.taskStatus} />
                            {item.priority !== "NORMAL" ? (
                              <StatusBadge status={item.priority} />
                            ) : null}
                            {item.isDelayed ? (
                              <StatusBadge
                                status="LATE"
                                tone="danger"
                                label="Late"
                              />
                            ) : null}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {item.orderNumber} · {item.customerName} ·{" "}
                            {item.serviceName} · due {item.dueAt}
                          </p>
                        </button>

                        <Link
                          href={`/garments/${item.garmentCode}`}
                          className="shrink-0 text-xs text-primary hover:underline"
                        >
                          Details
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
