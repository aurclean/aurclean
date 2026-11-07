"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  History,
  Printer,
  ScanLine,
  Search,
  Trash2,
  Volume2,
  VolumeX,
  X,
  XCircle,
  User,
  Package,
  Calendar,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { signalDataChange } from "@/components/shared/live-refresh";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Scanner } from "@/components/shared/scanner";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatCurrency } from "@/lib/money";
import { formatDate, formatDateTime, formatRelative } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { ScanHistoryRow, ScanResult } from "@/lib/services/scanning";

import { scanGarmentAction, scanHistoryAction, scanUpdateStatusAction } from "./actions";

interface Props {
  history: ScanHistoryRow[];
  canUpdateStatus: boolean;
  canResolve: boolean;
}

interface OrderContext {
  id: string;
  orderNumber: string;
  customerName: string;
}

// Audio Feedback Synthesizer for Workstation Scans
function playAudioFeedback(type: "FOUND" | "MISMATCH" | "DUPLICATE" | "NOT_FOUND") {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    if (type === "FOUND") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } else if (type === "DUPLICATE") {
      const now = ctx.currentTime;
      [now, now + 0.08].forEach((t) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(587.33, t);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.07);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.07);
      });
    } else {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.28);
    }
  } catch {
    // Audio context error ignored
  }
}

export function ScanStation({ history: initialHistory, canUpdateStatus, canResolve }: Props) {
  const router = useRouter();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [context, setContext] = useState<OrderContext | null>(null);
  const [contextInput, setContextInput] = useState("");
  const [manualQuery, setManualQuery] = useState("");
  const [history, setHistory] = useState(initialHistory);
  const [clearedAt, setClearedAt] = useState<number | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const [pending, startTransition] = useTransition();
  const [statusPending, startStatusTransition] = useTransition();
  const resultRef = useRef<HTMLDivElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);

  const visibleHistory = clearedAt
    ? history.filter((row) => new Date(row.scannedAt).getTime() > clearedAt)
    : history;

  const refreshHistory = useCallback(() => {
    startTransition(async () => {
      const res = await scanHistoryAction({});
      if (res.ok) setHistory(res.data);
    });
  }, []);

  const runScan = useCallback(
    (code: string, source: "KEYBOARD" | "CAMERA" = "KEYBOARD") =>
      new Promise<void>((resolve) => {
        startTransition(async () => {
          try {
            const res = await scanGarmentAction({
              code,
              source,
              contextOrderId: context?.id ?? null,
            });
            if (!res.ok) {
              toast.error(res.error);
              if (soundEnabled) playAudioFeedback("NOT_FOUND");
              resolve();
              return;
            }

            setResult(res.data);
            if (soundEnabled) {
              playAudioFeedback(res.data.kind);
            }

            if (res.data.kind === "FOUND") {
              toast.success(res.data.message);
            } else if (res.data.kind === "DUPLICATE") {
              toast.info(res.data.message);
            } else {
              toast.error(res.data.message);
            }
            refreshHistory();
          } catch (err) {
            console.error("Scan processing error:", err);
            toast.error("Failed to process scan. Please try again.");
          } finally {
            resolve();
          }
        });
      }),
    [context, refreshHistory, soundEnabled],
  );

  const scanNext = useCallback(() => {
    setResult(null);
  }, []);

  const setOrderContext = useCallback(() => {
    const value = contextInput.trim();
    if (!value) return;
    startTransition(async () => {
      const res = await scanGarmentAction({ code: value, source: "KEYBOARD" });
      if (res.ok && res.data.garment) {
        setContext({
          id: res.data.garment.orderId,
          orderNumber: res.data.garment.orderNumber,
          customerName: res.data.garment.customerName,
        });
        setContextInput("");
        toast.success(`Scanning lock engaged for ${res.data.garment.orderNumber}`);
      } else {
        toast.error("No order matches that code");
      }
      refreshHistory();
    });
  }, [contextInput, refreshHistory]);

  const status =
    result === null
      ? "Ready to scan"
      : result.kind === "FOUND"
        ? "Garment found"
        : result.kind === "DUPLICATE"
          ? "Already scanned"
          : result.kind === "MISMATCH"
            ? "Mismatch detected"
            : "Tag not found";

  const handleScan = useCallback(
    (code: string, source: "keyboard" | "camera") => {
      return runScan(code, source === "camera" ? "CAMERA" : "KEYBOARD");
    },
    [runScan],
  );

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-5">
        {/* Workstation Scanner Frame */}
        <Card className="border-primary/30 shadow-md bg-gradient-to-b from-card to-muted/20">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/60">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ScanLine className="size-5" />
              </div>
              <div>
                <CardTitle className="text-base font-bold tracking-tight">Workstation Scanner</CardTitle>
                <p className="text-xs text-muted-foreground">Aim barcode gun or hold tag in front of camera</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSoundEnabled(!soundEnabled)}
                className="h-8 px-2 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                title={soundEnabled ? "Audio chime ON" : "Audio chime OFF"}
              >
                {soundEnabled ? <Volume2 className="size-4 text-emerald-600 dark:text-emerald-400" /> : <VolumeX className="size-4" />}
                {soundEnabled ? "Audio ON" : "Muted"}
              </Button>

              {context ? (
                <Badge tone="info" className="gap-1.5 py-1 px-2.5 font-medium">
                  Order: {context.orderNumber}
                  <button
                    type="button"
                    onClick={() => setContext(null)}
                    aria-label="Clear order context"
                    className="ml-1 rounded-full hover:bg-black/15 dark:hover:bg-white/20 p-0.5"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ) : null}

              <Badge
                tone={
                  result?.kind === "FOUND"
                    ? "success"
                    : result?.kind === "DUPLICATE"
                      ? "warning"
                      : result?.kind === "MISMATCH" || result?.kind === "NOT_FOUND"
                        ? "danger"
                        : "neutral"
                }
                className="whitespace-nowrap px-3 py-1 font-semibold uppercase tracking-wider text-[11px]"
              >
                {status}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 pt-5">
            <div
              className={cn(
                "relative overflow-hidden rounded-xl border-2 transition-all",
                pending
                  ? "border-primary shadow-lg shadow-primary/20 scan-sweep"
                  : "border-border/80 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20",
              )}
            >
              <Scanner
                variant="workstation"
                onScan={handleScan}
                placeholder="Scan tag (TR-1042-01) or type code..."
                debounceMs={1200}
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-muted-foreground bg-muted/40 p-2.5 rounded-lg border border-border/50">
              <span className="flex items-center gap-1.5 font-medium">
                <Sparkles className="size-3.5 text-primary" />
                Compatible with hardware USB/Bluetooth barcode guns & camera feed
              </span>
              <span className="font-mono text-[11px]">Press [ENTER] after manual input</span>
            </div>

            {!context ? (
              <div className="flex items-center gap-2 border-t border-border/60 pt-3">
                <Input
                  value={contextInput}
                  onChange={(event) => setContextInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      setOrderContext();
                    }
                  }}
                  placeholder="Optional: Scan order number (e.g. ORD-1024) to lock stray detection"
                  className="h-9 font-mono text-xs bg-background"
                />
                <Button size="sm" variant="outline" onClick={setOrderContext} disabled={pending} className="h-9 font-semibold text-xs whitespace-nowrap">
                  Lock Order Context
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Scan Result Panel */}
        <div ref={resultRef}>
          {result ? (
            <ResultPanel
              result={result}
              canUpdateStatus={canUpdateStatus}
              canResolve={canResolve}
              pending={pending || statusPending}
              onScanNext={scanNext}
              onSearchManually={() => manualInputRef.current?.focus()}
              onUpdateStatus={(garmentId) =>
                startStatusTransition(async () => {
                  const res = await scanUpdateStatusAction({ garmentId });
                  if (res.ok) {
                    toast.success(
                      res.data.nextStage
                        ? `Stage updated to ${res.data.nextStage.replace(/_/g, " ").toLowerCase()}`
                        : `Status set to ${res.data.status.replace(/_/g, " ").toLowerCase()}`,
                    );
                    signalDataChange();
                    router.refresh();
                    scanNext();
                  } else {
                    toast.error(res.error);
                  }
                })
              }
            />
          ) : (
            <Card className="border-dashed border-2 bg-muted/10">
              <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground/60 shadow-xs mb-1">
                  <ScanLine className="size-7" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">Workstation Ready for Next Garment</h3>
                <p className="text-xs text-muted-foreground max-w-sm">
                  Scan any garment tag or barcode. Owner profile, order status, and stage controls will appear here instantly.
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Manual Lookup Form */}
        <Card className="border-border/80">
          <CardHeader className="py-3 px-4">
            <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Search className="size-3.5" /> Manual Lookup Fallback
            </CardTitle>
          </CardHeader>
          <CardContent className="py-2 px-4 pb-4">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (manualQuery.trim()) {
                  void runScan(manualQuery.trim());
                  setManualQuery("");
                }
              }}
            >
              <Input
                ref={manualInputRef}
                value={manualQuery}
                onChange={(event) => setManualQuery(event.target.value)}
                placeholder="Type Garment Tag ID (TR-1042-01) or Order #"
                className="h-9 font-mono text-xs"
              />
              <Button type="submit" size="sm" variant="secondary" disabled={pending} className="h-9 px-4 font-semibold text-xs whitespace-nowrap">
                Lookup Tag
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Recent Quick Tags */}
        {visibleHistory.length > 0 ? (
          <div className="space-y-2">
            <p className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
              <span className="flex items-center gap-1.5">
                <History className="size-3.5" /> Recent Scans ({visibleHistory.length})
              </span>
              <span className="text-[11px] font-normal lowercase text-muted-foreground">click to reopen</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {visibleHistory.slice(0, 16).map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => {
                    if (row.garmentCode) void runScan(row.garmentCode);
                    else if (row.orderNumber) void runScan(row.orderNumber);
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-xs transition-all hover:scale-102 active:scale-98 shadow-xs",
                    row.succeeded
                      ? "border-emerald-500/30 bg-emerald-500/10 text-foreground hover:bg-emerald-500/20"
                      : "border-rose-500/30 bg-rose-500/10 text-foreground hover:bg-rose-500/20",
                  )}
                  title={row.message ?? undefined}
                >
                  <span className={cn("size-2 rounded-full", row.succeeded ? "bg-emerald-500" : "bg-rose-500")} />
                  <span className="font-bold">{row.garmentCode ?? row.orderNumber ?? row.rawCode}</span>
                  {row.customerName ? (
                    <span className="text-muted-foreground font-sans truncate max-w-[120px]">({row.customerName})</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* Right Column: Workstation Audit Scan Log */}
      <Card className="h-fit min-w-0 border-border/80 shadow-xs">
        <CardHeader className="flex-row items-center justify-between gap-2 pb-3 border-b border-border/60">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <History className="size-4 text-primary" /> Session Activity Log
          </CardTitle>
          {visibleHistory.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => setClearedAt(Date.now())}
            >
              <Trash2 className="size-3.5" /> Clear
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="pt-3 px-3">
          {visibleHistory.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <History className="size-8 text-muted-foreground/30 mx-auto" />
              <p className="text-xs text-muted-foreground">Session log empty. Ready to record scans.</p>
            </div>
          ) : (
            <ol className="max-h-[580px] space-y-1.5 overflow-y-auto pr-1">
              {visibleHistory.map((row) => (
                <li key={row.id}>
                  <ScanHistoryItem
                    row={row}
                    onReopen={(code) => void runScan(code)}
                  />
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const PIPELINE: { token: string; label: string }[] = [
  { token: "WASH", label: "Washing" },
  { token: "DRI", label: "Drying" },
  { token: "IRON", label: "Ironing" },
  { token: "PACK", label: "Packing" },
  { token: "READY", label: "Ready" },
  { token: "DELIVERED", label: "Delivered" },
];

function pipelineIndex(status: string): number {
  const index = PIPELINE.findIndex((step) => status.startsWith(step.token));
  return index === -1 ? 0 : index;
}

function StageStepper({ status }: { status: string }) {
  const current = pipelineIndex(status);
  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      {PIPELINE.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <div key={step.token} className="flex items-center gap-2">
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-all shadow-xs",
                done && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30",
                active && "bg-primary text-primary-foreground shadow-md ring-2 ring-primary/30 animate-pulse",
                !done && !active && "bg-muted text-muted-foreground border border-border/50",
              )}
            >
              {done ? <Check className="size-3.5 stroke-[3]" /> : null}
              {step.label}
            </span>
            {index < PIPELINE.length - 1 ? (
              <ArrowRight className="size-3 text-muted-foreground/40" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ResultPanel({
  result,
  canUpdateStatus,
  canResolve,
  pending,
  onScanNext,
  onSearchManually,
  onUpdateStatus,
}: {
  result: ScanResult;
  canUpdateStatus: boolean;
  canResolve: boolean;
  pending: boolean;
  onScanNext: () => void;
  onSearchManually: () => void;
  onUpdateStatus: (garmentId: string) => void;
}) {
  if (result.kind === "MISMATCH" && result.mismatch) {
    return <MismatchPanel mismatch={result.mismatch} canResolve={canResolve} onScanNext={onScanNext} />;
  }

  if (result.kind === "NOT_FOUND") {
    return (
      <Card className="animate-shake border-2 border-amber-500/50 bg-amber-500/10 shadow-md">
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="size-6" />
            </span>
            <div>
              <p className="text-base font-bold text-amber-700 dark:text-amber-300">Tag / QR Code Not Recognized</p>
              <p className="text-xs text-muted-foreground mt-0.5">{result.message}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1 border-t border-amber-500/20">
            <Button size="sm" onClick={onScanNext} className="gap-1.5 font-semibold">
              <ScanLine className="size-4" /> Scan Again
            </Button>
            <Button size="sm" variant="outline" onClick={onSearchManually} className="gap-1.5 font-semibold">
              <Search className="size-4" /> Search Manually
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const garment = result.garment;
  if (!garment) return null;

  const isDuplicate = result.kind === "DUPLICATE";

  return (
    <Card
      key={garment.garmentId + result.kind}
      className={cn(
        "animate-pop border-2 shadow-lg transition-all",
        isDuplicate
          ? "border-amber-500/50 bg-gradient-to-br from-card via-card to-amber-500/10"
          : "border-emerald-500/50 bg-gradient-to-br from-card via-card to-emerald-500/10",
      )}
    >
      <CardContent className="space-y-5 pt-6">
        {/* Header HUD Banner */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={cn("size-3 rounded-full animate-pulse", isDuplicate ? "bg-amber-500" : "bg-emerald-500")} />
              <h3 className="text-lg font-bold tracking-tight">
                {isDuplicate ? "Garment Already Scanned" : "Garment Verified Successfully"}
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              {isDuplicate ? result.message : `Belongs to customer ${garment.customerName}`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <StatusBadge status={garment.status} label={garment.statusLabel} dot />
          </div>
        </div>

        {/* Tag Code & Category Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/40 p-3 rounded-xl border border-border/50">
          <div className="flex items-center gap-3">
            <span className="font-mono text-3xl font-extrabold tracking-tight text-foreground">
              {garment.garmentCode}
            </span>
            <Badge tone="info" className="text-xs py-1 px-2.5 font-medium">
              {garment.categoryEmoji} {garment.categoryLabel}
            </Badge>
          </div>

          <div className="text-right text-xs">
            <span className="text-muted-foreground">Expected Delivery:</span>
            <span className="block font-semibold text-foreground">{formatDate(garment.expectedDeliveryAt)}</span>
          </div>
        </div>

        {garment.warning ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-amber-500/50 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-700 dark:text-amber-300 font-medium"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>{garment.warning}</span>
          </div>
        ) : null}

        {/* Garment Fact Cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="bg-card p-3 rounded-xl border border-border/60 shadow-xs space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <User className="size-3 text-primary" /> Customer Profile
            </span>
            <p className="text-sm font-bold truncate">
              <Link href={garment.customerId ? `/customers/${garment.customerId}` : "#"} className="hover:underline text-primary">
                {garment.customerName}
              </Link>
            </p>
            <p className="font-mono text-xs text-muted-foreground">{garment.customerPhone}</p>
          </div>

          <div className="bg-card p-3 rounded-xl border border-border/60 shadow-xs space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Package className="size-3 text-primary" /> Order Details
            </span>
            <p className="text-sm font-bold font-mono">
              <Link href={`/orders/${garment.orderId}`} className="text-primary hover:underline">
                {garment.orderNumber}
              </Link>
            </p>
            <p className="text-xs text-muted-foreground truncate">{garment.orderItemsSummary || "—"}</p>
          </div>

          <div className="bg-card p-3 rounded-xl border border-border/60 shadow-xs space-y-1 sm:col-span-2 lg:col-span-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Calendar className="size-3 text-primary" /> Payment Balance
            </span>
            <p className="text-xs font-medium text-foreground">
              {formatCurrency(garment.paidAmount)} of {formatCurrency(garment.totalAmount)} paid
            </p>
            {garment.outstandingAmount > 0 ? (
              <p className="text-xs font-bold text-rose-600 dark:text-rose-400">
                {formatCurrency(garment.outstandingAmount)} balance due
              </p>
            ) : (
              <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Balance Fully Paid</p>
            )}
          </div>
        </div>

        {/* Live Stage Stepper */}
        {!isDuplicate ? (
          <div className="space-y-2 border-t border-border/60 pt-4">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Processing Pipeline Stage
            </span>
            <StageStepper status={garment.status} />
          </div>
        ) : null}

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5 border-t border-border/60 pt-4">
          {canUpdateStatus && !isDuplicate ? (
            <Button
              size="lg"
              disabled={pending}
              onClick={() => onUpdateStatus(garment.garmentId)}
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700 font-semibold shadow-md shadow-emerald-600/20"
            >
              <ArrowRight className="size-4" /> Advance to Next Stage
            </Button>
          ) : null}
          <Button size="lg" variant="outline" asChild className="gap-1.5 font-semibold">
            <Link href={`/orders/${garment.orderId}`}>
              <ExternalLink className="size-4" /> View Full Order
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild className="gap-1.5 font-semibold">
            <Link href={`/orders/${garment.orderId}/tags`}>
              <Printer className="size-4" /> {garment.lastScannedAt ? "Reprint Tag" : "Print Thermal Tag"}
            </Link>
          </Button>
          <Button size="lg" variant="secondary" onClick={onScanNext} className="gap-1.5 font-semibold ml-auto">
            <ScanLine className="size-4" /> Scan Next
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MismatchPanel({
  mismatch,
  canResolve,
  onScanNext,
}: {
  mismatch: NonNullable<ScanResult["mismatch"]>;
  canResolve: boolean;
  onScanNext: () => void;
}) {
  return (
    <Card className="animate-shake border-2 border-rose-500/60 bg-gradient-to-br from-card via-card to-rose-500/10 shadow-lg">
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center gap-3 border-b border-rose-500/20 pb-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-rose-500/20 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="size-6" />
          </span>
          <div>
            <h3 className="text-base font-bold text-rose-600 dark:text-rose-400">Garment Mismatch Alert</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{mismatch.detail}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
          <div className="p-2.5 rounded-lg border bg-card space-y-0.5">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground">Scanned Garment Tag</span>
            <p className="font-mono font-bold text-sm text-foreground">{mismatch.garmentCode}</p>
            <p className="text-muted-foreground">{mismatch.categoryLabel}</p>
          </div>
          <div className="p-2.5 rounded-lg border bg-card space-y-0.5">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground">Actual Owner</span>
            <p className="font-bold text-sm text-foreground">{mismatch.actualCustomerName}</p>
            <p className="font-mono text-primary">{mismatch.actualOrderNumber}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-rose-500/20 pt-4">
          <Button size="sm" asChild className="gap-1.5 font-semibold">
            <Link href={`/orders/${mismatch.actualOrderId}`}>
              <ExternalLink className="size-4" /> View Correct Order
            </Link>
          </Button>
          {canResolve ? (
            <Button size="sm" variant="outline" asChild className="gap-1.5 font-semibold">
              <Link href={`/mismatch?q=${mismatch.garmentCode}`}>
                <ArrowRight className="size-4" /> Correct Assignment
              </Link>
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={onScanNext} className="gap-1.5 font-semibold ml-auto">
            <ScanLine className="size-4" /> Scan Again
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ScanHistoryItem({ row, onReopen }: { row: ScanHistoryRow; onReopen: (code: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onReopen(row.garmentCode ?? row.orderNumber ?? row.rawCode)}
      className="flex w-full items-start gap-2.5 rounded-xl p-2.5 text-left transition-all hover:bg-muted/60 border border-transparent hover:border-border/60"
    >
      {row.succeeded ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
      ) : (
        <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate font-mono text-xs font-bold text-foreground">
            {row.garmentCode ?? row.orderNumber ?? row.rawCode}
          </span>
          <TimeAgo value={row.scannedAt} />
        </span>
        <span className="block truncate text-[11px] text-muted-foreground mt-0.5">
          {row.customerName ?? row.message ?? row.resolvedAs}
        </span>
      </span>
    </button>
  );
}

function TimeAgo({ value }: { value: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <span
      className="shrink-0 text-[10px] text-muted-foreground font-mono"
      title={mounted ? formatDateTime(value) : undefined}
      suppressHydrationWarning
    >
      {mounted ? formatRelative(value) : ""}
    </span>
  );
}

