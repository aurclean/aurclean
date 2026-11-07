"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  Download,
  Filter,
  Layers,
  Loader2,
  Play,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Square,
  Volume2,
  VolumeX,
  XCircle,
  Sparkles,
  Activity,
  Check,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Scanner } from "@/components/shared/scanner";
import { cn } from "@/lib/utils";

import { scanGarmentAction } from "./actions";
import { batchScanGarmentAction, fetchBatchExpectedGarmentsAction } from "./batch-actions";
import type { BatchScanItemResult, ExpectedGarment } from "@/lib/services/batch-scanning";

// Web Audio API Sound Synthesizer for instant audible feedback on shop floor
function playAudioFeedback(type: "MATCHED" | "MISMATCH" | "DUPLICATE" | "UNKNOWN") {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    if (type === "MATCHED") {
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
      [now, now + 0.1].forEach((t) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(587.33, t);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.08);
      });
    } else {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch {
    // Audio context error ignored
  }
}

export function BatchScanner() {
  const [active, setActive] = useState(false);
  const [operation, setOperation] = useState<string>("PACKING");
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [expectedCountInput, setExpectedCountInput] = useState<string>("50");
  const [contextOrderNumber, setContextOrderNumber] = useState<string>("");
  const [contextOrderId, setContextOrderId] = useState<string | null>(null);

  const [scans, setScans] = useState<BatchScanItemResult[]>([]);
  const [expectedList, setExpectedList] = useState<ExpectedGarment[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const [inputVal, setInputVal] = useState("");
  const [pending, startTransition] = useTransition();
  const [contextLocking, startContextTransition] = useTransition();
  const [lockedOrderNumber, setLockedOrderNumber] = useState<string | null>(null);

  const [finished, setFinished] = useState(false);
  const [summaryFilter, setSummaryFilter] = useState<"ALL" | "MISMATCHES" | "MISSING">("ALL");

  const inputRef = useRef<HTMLInputElement>(null);
  const lastScanTimeRef = useRef<{ code: string; time: number }>({ code: "", time: 0 });

  useEffect(() => {
    if (!active || finished) return;
    const timer = setInterval(() => {
      if (document.activeElement !== inputRef.current && inputRef.current) {
        const tag = document.activeElement?.tagName.toLowerCase();
        if (tag !== "input" && tag !== "select" && tag !== "textarea") {
          inputRef.current.focus();
        }
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [active, finished]);

  const handleStartBatch = () => {
    setActive(true);
    setFinished(false);
    setScans([]);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  };

  const processScan = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim();
      if (!code || pending || !active) return;

      const now = Date.now();
      if (
        lastScanTimeRef.current.code === code.toUpperCase() &&
        now - lastScanTimeRef.current.time < 1500
      ) {
        return;
      }
      lastScanTimeRef.current = { code: code.toUpperCase(), time: now };

      setInputVal("");

      const alreadyCodes = scans.map((s) => s.garmentCode).filter((c): c is string => Boolean(c));

      startTransition(async () => {
        try {
          const res = await batchScanGarmentAction({
            code,
            operation: operation === "NONE" ? null : operation,
            contextOrderId: contextOrderId ?? undefined,
            autoAdvance,
            alreadyScannedCodes: alreadyCodes,
          });

          if (res.ok) {
            const item = res.data;
            setScans((prev) => [item, ...prev]);

            if (soundEnabled) {
              playAudioFeedback(item.outcome);
            }

            if (item.outcome === "MATCHED") {
              toast.success(item.message, { duration: 1500 });
            } else if (item.outcome === "DUPLICATE") {
              toast.info(item.message, { duration: 2000 });
            } else if (item.outcome === "MISMATCH") {
              toast.error(`MISMATCH: ${item.message}`, { duration: 3000 });
            } else {
              toast.error(item.message, { duration: 3000 });
            }
          } else {
            toast.error(res.error);
          }
        } catch (err) {
          console.error("Batch scan error:", err);
          toast.error("Failed to process batch scan item");
        } finally {
          setTimeout(() => inputRef.current?.focus(), 50);
        }
      });
    },
    [active, autoAdvance, contextOrderId, operation, pending, scans, soundEnabled],
  );

  const handleFinishBatch = () => {
    setActive(false);
    setFinished(true);
  };

  const handleLockOrderContext = () => {
    const value = contextOrderNumber.trim();
    if (!value || contextLocking) return;

    startContextTransition(async () => {
      const res = await scanGarmentAction({ code: value, source: "KEYBOARD" });
      if (!res.ok || !res.data.garment) {
        toast.error("No order matches that code");
        return;
      }

      const { orderId, orderNumber, customerName } = res.data.garment;
      setContextOrderId(orderId);
      setLockedOrderNumber(orderNumber);
      setContextOrderNumber(orderNumber);
      toast.success(`Batch locked to ${orderNumber} (${customerName})`);

      const expected = await fetchBatchExpectedGarmentsAction({ orderId });
      if (expected.ok) {
        setExpectedList(expected.data);
        setExpectedCountInput(String(expected.data.length));
      }
    });
  };

  const handleClearOrderContext = () => {
    setContextOrderId(null);
    setLockedOrderNumber(null);
    setContextOrderNumber("");
    setExpectedList([]);
  };

  const expectedNum = parseInt(expectedCountInput, 10) || 0;
  const scannedNum = scans.length;
  const matchedNum = scans.filter((s) => s.outcome === "MATCHED").length;
  const mismatchNum = scans.filter((s) => s.outcome === "MISMATCH").length;
  const duplicateNum = scans.filter((s) => s.outcome === "DUPLICATE").length;
  const unknownNum = scans.filter((s) => s.outcome === "UNKNOWN").length;

  const matchedCodes = new Set(scans.filter((s) => s.outcome === "MATCHED").map((s) => s.garmentCode));
  const missingGarments = expectedList.filter((g) => !matchedCodes.has(g.garmentCode));

  const remainingNum = expectedList.length > 0
    ? missingGarments.length
    : Math.max(0, expectedNum ? expectedNum - matchedNum : 0);

  return (
    <div className="space-y-6">
      {/* Configuration & Mission Control Bar */}
      <Card className="border-primary/40 shadow-lg bg-gradient-to-r from-card via-card to-primary/10">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-4 pb-3 border-b border-border/60">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/25">
              <Layers className="size-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-xl font-extrabold tracking-tight">HIGH-SPEED BATCH SCANNER</CardTitle>
                <Badge tone="info" className="text-[10px] uppercase font-bold py-0.5 px-2">
                  Continuous Mode
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Bulk garment processing, automated stage advancement, and stray detection
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSoundEnabled(!soundEnabled)}
              title={soundEnabled ? "Audio chime ON" : "Audio chime OFF"}
              className="gap-1.5 font-semibold text-xs h-9 px-3"
            >
              {soundEnabled ? <Volume2 className="size-4 text-emerald-600 dark:text-emerald-400" /> : <VolumeX className="size-4 text-muted-foreground" />}
              {soundEnabled ? "Audio Chime ON" : "Audio Muted"}
            </Button>

            {!active ? (
              <Button
                size="lg"
                className="gap-2 bg-emerald-600 font-bold text-white hover:bg-emerald-700 shadow-md shadow-emerald-600/20 px-6 h-11"
                onClick={handleStartBatch}
              >
                <Play className="size-4 fill-white" /> START BATCH SESSION
              </Button>
            ) : (
              <Button
                size="lg"
                variant="destructive"
                className="gap-2 font-bold shadow-md px-6 h-11"
                onClick={handleFinishBatch}
              >
                <Square className="size-4 fill-white" /> FINISH BATCH
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Batch Operation</Label>
              <Select value={operation} onValueChange={setOperation} disabled={active}>
                <SelectTrigger className="h-10 bg-background font-semibold text-xs">
                  <SelectValue placeholder="Select Operation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Verification Only (No Stage Advance)</SelectItem>
                  <SelectItem value="RECEIVING">Receiving Batch</SelectItem>
                  <SelectItem value="WASHING">Washing Batch</SelectItem>
                  <SelectItem value="DRYING">Drying Batch</SelectItem>
                  <SelectItem value="IRONING">Ironing Batch</SelectItem>
                  <SelectItem value="PACKING">Packing Batch</SelectItem>
                  <SelectItem value="READY">Ready Batch</SelectItem>
                  <SelectItem value="DELIVERY_PREP">Delivery Prep</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Expected Target Quantity</Label>
              <Input
                type="number"
                min="0"
                value={expectedCountInput}
                onChange={(e) => setExpectedCountInput(e.target.value)}
                placeholder="50"
                className="h-10 font-mono text-sm font-bold bg-background"
                disabled={active}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Order Context (Optional)</Label>
              {lockedOrderNumber ? (
                <div className="flex h-10 items-center justify-between rounded-md border border-primary/40 bg-primary/5 px-3">
                  <span className="truncate font-mono text-sm font-bold text-primary">{lockedOrderNumber}</span>
                  <button
                    type="button"
                    onClick={handleClearOrderContext}
                    disabled={active}
                    aria-label="Clear order context"
                    className="ml-2 shrink-0 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    Clear
                  </button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <Input
                    value={contextOrderNumber}
                    onChange={(e) => setContextOrderNumber(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleLockOrderContext();
                      }
                    }}
                    placeholder="ORD-1024"
                    className="h-10 font-mono text-sm uppercase bg-background"
                    disabled={active || contextLocking}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 px-3 font-semibold text-xs whitespace-nowrap"
                    onClick={handleLockOrderContext}
                    disabled={active || contextLocking || !contextOrderNumber.trim()}
                  >
                    Lock
                  </Button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border/80 bg-background p-3">
              <div className="space-y-0.5">
                <Label className="text-xs font-bold">Auto Stage Advance</Label>
                <p className="text-[11px] text-muted-foreground">Auto-update status on match</p>
              </div>
              <Switch checked={autoAdvance} onCheckedChange={setAutoAdvance} disabled={active} />
            </div>
          </div>

          {active && (
            <div className="flex items-center gap-2.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/20">
              <span className="relative flex size-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-3 rounded-full bg-emerald-500" />
              </span>
              CONTINUOUS BATCH SCANNING ACTIVE — Point hardware barcode gun or camera scanner continuously
            </div>
          )}
        </CardContent>
      </Card>

      {/* Operational Metrics Bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        <Card className="border-border/60 bg-card shadow-xs">
          <CardContent className="p-3.5 text-center">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Expected</span>
            <p className="mt-1 text-3xl font-extrabold font-mono text-foreground">{expectedNum}</p>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card shadow-xs">
          <CardContent className="p-3.5 text-center">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Total Scanned</span>
            <p className="mt-1 text-3xl font-extrabold font-mono text-foreground">{scannedNum}</p>
          </CardContent>
        </Card>

        <Card className="border-emerald-500/40 bg-emerald-500/10 shadow-xs">
          <CardContent className="p-3.5 text-center">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Matched</span>
            <p className="mt-1 text-3xl font-extrabold font-mono text-emerald-600 dark:text-emerald-400">{matchedNum}</p>
          </CardContent>
        </Card>

        <Card className="border-rose-500/40 bg-rose-500/10 shadow-xs">
          <CardContent className="p-3.5 text-center">
            <span className="text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">Mismatches</span>
            <p className="mt-1 text-3xl font-extrabold font-mono text-rose-600 dark:text-rose-400">{mismatchNum + unknownNum}</p>
          </CardContent>
        </Card>

        <Card className="border-amber-500/40 bg-amber-500/10 shadow-xs">
          <CardContent className="p-3.5 text-center">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">Duplicates</span>
            <p className="mt-1 text-3xl font-extrabold font-mono text-amber-600 dark:text-amber-400">{duplicateNum}</p>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card shadow-xs">
          <CardContent className="p-3.5 text-center">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Remaining</span>
            <p className="mt-1 text-3xl font-extrabold font-mono text-muted-foreground">{remainingNum}</p>
          </CardContent>
        </Card>
      </div>

      {/* Hardware Scanner Field & Camera Scanner */}
      {active && (
        <Card className="border-2 border-primary bg-card shadow-lg animate-fade-in-soft">
          <CardContent className="space-y-4 pt-5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void processScan(inputVal);
              }}
              className="flex flex-col sm:flex-row items-stretch gap-3"
            >
              <div className="relative flex-1">
                <Input
                  ref={inputRef}
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  placeholder="Continuous barcode / QR scan input (TR-1024-01 + ENTER)…"
                  className="h-14 font-mono text-xl uppercase tracking-wider pr-12 border-primary/50 shadow-sm focus-visible:ring-2 focus-visible:ring-primary font-bold"
                  autoFocus
                  disabled={pending}
                />
                {pending && (
                  <Loader2 className="absolute right-4 top-1/2 size-6 -translate-y-1/2 animate-spin text-primary" />
                )}
              </div>
              <Button type="submit" size="lg" className="h-14 px-8 font-bold text-base bg-primary" disabled={pending || !inputVal.trim()}>
                Process Tag
              </Button>
            </form>

            <div className="rounded-xl bg-muted/40 p-3 border border-border/60">
              <Scanner
                variant="compact"
                placeholder="Scan using device camera stream..."
                onScan={processScan}
                debounceMs={1200}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Live Scanned Feed */}
      <Card className="border-border/80 shadow-xs">
        <CardHeader className="flex-row items-center justify-between pb-3 border-b border-border/60">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <ScanLine className="size-4 text-primary" /> Batch Session Stream ({scans.length})
          </CardTitle>
          {scans.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setScans([])} disabled={active} className="text-xs text-muted-foreground hover:text-destructive">
              Clear Stream
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-4">
          {scans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center text-muted-foreground space-y-2">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground/50">
                <ScanLine className="size-7" />
              </div>
              <p className="text-sm font-bold text-foreground">No garments scanned in this batch session</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                Click &quot;START BATCH SESSION&quot; above and start scanning tags continuously.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
              {scans.map((scan) => (
                <div
                  key={scan.id}
                  className={cn(
                    "flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl border transition-all gap-3 shadow-xs animate-pop",
                    scan.outcome === "MATCHED" && "border-emerald-500/40 bg-emerald-500/10",
                    scan.outcome === "MISMATCH" && "border-rose-500/50 bg-rose-500/10",
                    scan.outcome === "DUPLICATE" && "border-amber-500/40 bg-amber-500/10",
                    scan.outcome === "UNKNOWN" && "border-rose-500/50 bg-rose-500/10",
                  )}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    {scan.outcome === "MATCHED" && (
                      <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5 stroke-[2.5]" />
                    )}
                    {scan.outcome === "MISMATCH" && (
                      <AlertTriangle className="size-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5 stroke-[2.5]" />
                    )}
                    {scan.outcome === "DUPLICATE" && (
                      <RotateCcw className="size-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 stroke-[2.5]" />
                    )}
                    {scan.outcome === "UNKNOWN" && (
                      <XCircle className="size-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5 stroke-[2.5]" />
                    )}

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-extrabold text-sm tracking-tight text-foreground">
                          {scan.garmentCode ?? scan.rawCode}
                        </span>
                        {scan.customerName && (
                          <span className="text-sm font-semibold text-foreground truncate">
                            — {scan.customerName}
                          </span>
                        )}
                        {scan.categoryLabel && (
                          <Badge tone="info" className="text-[11px] font-medium py-0.5 px-2">
                            {scan.categoryEmoji} {scan.categoryLabel}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {scan.detail || scan.message}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs shrink-0 self-end sm:self-auto">
                    {scan.outcome === "MATCHED" && (
                      <Badge tone="success" className="font-bold">✓ MATCHED</Badge>
                    )}
                    {scan.outcome === "MISMATCH" && (
                      <Badge tone="danger" className="font-bold">⚠ MISMATCH</Badge>
                    )}
                    {scan.outcome === "DUPLICATE" && (
                      <Badge tone="warning" className="font-bold">↻ DUPLICATE</Badge>
                    )}
                    {scan.outcome === "UNKNOWN" && (
                      <Badge tone="danger" className="font-bold">✕ UNKNOWN</Badge>
                    )}
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {new Date(scan.scannedAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Batch Completion Audit Modal */}
      <Dialog open={finished} onOpenChange={setFinished}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto border-2 border-emerald-500/40">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-7 text-emerald-600 dark:text-emerald-400" /> BATCH SESSION RECONCILIATION
            </DialogTitle>
            <DialogDescription className="text-xs">
              Audit summary and stray garment analysis for completed batch session
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 my-3">
            {/* Summary Metrics Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              <div className="p-3 rounded-xl border bg-muted/20 text-center">
                <span className="text-[10px] uppercase font-bold text-muted-foreground">Expected</span>
                <p className="text-2xl font-extrabold font-mono">{expectedNum}</p>
              </div>
              <div className="p-3 rounded-xl border bg-muted/20 text-center">
                <span className="text-[10px] uppercase font-bold text-muted-foreground">Scanned</span>
                <p className="text-2xl font-extrabold font-mono">{scannedNum}</p>
              </div>
              <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-center">
                <span className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400">Matched</span>
                <p className="text-2xl font-extrabold font-mono text-emerald-600 dark:text-emerald-400">{matchedNum}</p>
              </div>
              <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-center">
                <span className="text-[10px] uppercase font-bold text-rose-600 dark:text-rose-400">Mismatch</span>
                <p className="text-2xl font-extrabold font-mono text-rose-600 dark:text-rose-400">{mismatchNum + unknownNum}</p>
              </div>
              <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-center">
                <span className="text-[10px] uppercase font-bold text-amber-600 dark:text-amber-400">Duplicate</span>
                <p className="text-2xl font-extrabold font-mono text-amber-600 dark:text-amber-400">{duplicateNum}</p>
              </div>
              <div className="p-3 rounded-xl border bg-muted/20 text-center">
                <span className="text-[10px] uppercase font-bold text-muted-foreground">Missing</span>
                <p className="text-2xl font-extrabold font-mono text-rose-500">{remainingNum}</p>
              </div>
            </div>

            {/* Reconciliation Filter Tabs */}
            <div className="flex items-center gap-2 border-b pb-2">
              <Button
                size="sm"
                variant={summaryFilter === "ALL" ? "default" : "outline"}
                onClick={() => setSummaryFilter("ALL")}
                className="font-semibold text-xs"
              >
                VIEW ALL SCANS ({scans.length})
              </Button>
              <Button
                size="sm"
                variant={summaryFilter === "MISMATCHES" ? "default" : "outline"}
                onClick={() => setSummaryFilter("MISMATCHES")}
                className={cn("font-semibold text-xs", mismatchNum + unknownNum > 0 && "text-rose-600 border-rose-300")}
              >
                VIEW MISMATCHES ({mismatchNum + unknownNum})
              </Button>
              <Button
                size="sm"
                variant={summaryFilter === "MISSING" ? "default" : "outline"}
                onClick={() => setSummaryFilter("MISSING")}
                className={cn("font-semibold text-xs", remainingNum > 0 && "text-amber-600 border-amber-300")}
              >
                VIEW MISSING ({remainingNum})
              </Button>
            </div>

            {/* Detailed Filtered Table */}
            <div className="max-h-64 overflow-y-auto space-y-2 border rounded-xl p-3 bg-muted/20">
              {summaryFilter === "ALL" && scans.map((scan) => (
                <div key={scan.id} className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-card border">
                  <span className="font-mono font-bold">{scan.garmentCode ?? scan.rawCode} — {scan.customerName || "Unknown"}</span>
                  <Badge tone={scan.outcome === "MATCHED" ? "success" : "danger"} className="font-bold">{scan.outcome}</Badge>
                </div>
              ))}

              {summaryFilter === "MISMATCHES" && (
                scans.filter((s) => s.outcome === "MISMATCH" || s.outcome === "UNKNOWN").length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No mismatches detected in this batch.</p>
                ) : (
                  scans.filter((s) => s.outcome === "MISMATCH" || s.outcome === "UNKNOWN").map((scan) => (
                    <div key={scan.id} className="flex items-center justify-between text-xs p-3 rounded-lg bg-rose-500/10 border border-rose-500/30">
                      <div>
                        <span className="font-mono font-bold text-sm">{scan.garmentCode ?? scan.rawCode}</span>
                        <p className="text-rose-600 dark:text-rose-400 mt-0.5">{scan.detail || scan.message}</p>
                      </div>
                      <Badge tone="danger" className="font-bold">{scan.outcome}</Badge>
                    </div>
                  ))
                )
              )}

              {summaryFilter === "MISSING" && (
                remainingNum === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">All expected garments were successfully scanned.</p>
                ) : missingGarments.length > 0 ? (
                  <div className="space-y-2">
                    {missingGarments.map((g) => (
                      <div key={g.garmentId} className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
                        <span className="font-mono font-bold">
                          {g.categoryEmoji} {g.garmentCode} — {g.customerName}
                        </span>
                        <span className="text-muted-foreground">{g.orderNumber}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 rounded-xl border border-amber-500/30">
                    <p className="font-bold text-sm">{remainingNum} expected garments were not scanned in this batch.</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Note: Missing garments remain in their current system stage and are NOT automatically altered or marked delivered.
                    </p>
                  </div>
                )
              )}
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t">
            <Button
              variant="outline"
              onClick={() => {
                setFinished(false);
                setScans([]);
              }}
              className="font-semibold"
            >
              Close Summary
            </Button>
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-700 font-bold px-6"
              onClick={() => {
                setFinished(false);
                setScans([]);
                handleStartBatch();
              }}
            >
              START NEW BATCH SESSION
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

