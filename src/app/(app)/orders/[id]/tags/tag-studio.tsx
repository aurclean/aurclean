"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  ArrowLeft,
  Eye,
  Layers,
  Printer,
  Receipt,
  RotateCcw,
  Tag as TagIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { TagSheet } from "@/lib/services/tags";

import { recordTagPrintAction } from "./actions";
import { GarmentTag, OrderTag } from "./thermal-tag";

type Scope = "ORDER" | "GARMENTS" | "BOTH";

const PRESETS = [
  { value: 58, label: '58 mm', hint: "Compact roll" },
  { value: 80, label: "80 mm", hint: "Standard roll" },
] as const;

const SCOPES: { value: Scope; label: string; icon: typeof TagIcon }[] = [
  { value: "ORDER", label: "Order tag", icon: TagIcon },
  { value: "GARMENTS", label: "Garment tags", icon: Layers },
  { value: "BOTH", label: "Both", icon: Printer },
];

export function TagStudio({ sheet }: { sheet: TagSheet }) {
  const [widthMm, setWidthMm] = useState(80);
  const [customWidth, setCustomWidth] = useState("70");
  const [useCustom, setUseCustom] = useState(false);
  const [scope, setScope] = useState<Scope>("ORDER");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [printCount, setPrintCount] = useState(sheet.tagPrintCount);
  const [lastPrinted, setLastPrinted] = useState(sheet.tagLastPrintedAt);
  const [reprintMark, setReprintMark] = useState(false);
  const [pending, startTransition] = useTransition();

  const effectiveWidth = useCustom
    ? Math.min(120, Math.max(40, Number(customWidth) || 80))
    : widthMm;

  // The roll width has to reach the print engine as a real @page size, and it
  // changes with the selector — so the rule is written into the document.
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-thermal-page", "true");
    style.textContent = `@media print { @page { size: ${effectiveWidth}mm auto; margin: 0; } }`;
    document.head.append(style);
    return () => style.remove();
  }, [effectiveWidth]);

  const tags = useMemo(() => {
    const list: Array<{ key: string; node: React.ReactNode }> = [];
    if (scope !== "GARMENTS") {
      list.push({
        key: "order",
        node: <OrderTag sheet={sheet} widthMm={effectiveWidth} reprint={reprintMark} />,
      });
    }
    if (scope !== "ORDER") {
      sheet.garments.forEach((garment, index) => {
        list.push({
          key: garment.id,
          node: (
            <GarmentTag
              sheet={sheet}
              widthMm={effectiveWidth}
              garment={garment}
              index={index}
            />
          ),
        });
      });
    }
    return list;
  }, [scope, sheet, effectiveWidth, reprintMark]);

  const runPrint = useCallback(
    (asReprint: boolean) => {
      setReprintMark(asReprint);
      // Let React paint the reprint marker before the print dialog freezes it.
      requestAnimationFrame(() => {
        document.body.dataset.printMode = "thermal";
        window.print();
        delete document.body.dataset.printMode;

        startTransition(async () => {
          const result = await recordTagPrintAction({
            orderId: sheet.orderId,
            scope,
            widthMm: effectiveWidth,
            copies: 1,
          });
          if (result.ok) {
            setPrintCount(result.data.tagPrintCount);
            setLastPrinted(result.data.tagLastPrintedAt);
            toast.success(
              asReprint || result.data.isReprint
                ? `Reprint recorded — ${result.data.tagPrintCount} prints of ${sheet.orderNumber}`
                : `Tag printed for ${sheet.orderNumber}`,
            );
          } else {
            toast.error(result.error);
          }
        });
      });
    },
    [effectiveWidth, scope, sheet.orderId, sheet.orderNumber],
  );

  const printAll = useCallback(() => {
    setScope("BOTH");
    requestAnimationFrame(() => runPrint(printCount > 0));
  }, [printCount, runPrint]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Tags for {sheet.orderNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            {sheet.garments.length} garment tag{sheet.garments.length === 1 ? "" : "s"} ·{" "}
            {printCount === 0
              ? "not printed yet"
              : `printed ${printCount}× · last ${formatDateTime(lastPrinted)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/orders/${sheet.orderId}`}>
              <ArrowLeft /> Back to order
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/orders/${sheet.orderId}/receipt`}>
              <Receipt /> Print receipt
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)] no-print">
        <Card>
          <CardContent className="space-y-5 pt-6">
            <div className="space-y-2">
              <Label>Paper width</Label>
              <div className="grid grid-cols-3 gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => {
                      setUseCustom(false);
                      setWidthMm(preset.value);
                    }}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left transition",
                      !useCustom && widthMm === preset.value
                        ? "border-primary bg-primary/10"
                        : "border-border hover:bg-accent",
                    )}
                  >
                    <span className="block text-sm font-semibold">{preset.label}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {preset.hint}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setUseCustom(true)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left transition",
                    useCustom ? "border-primary bg-primary/10" : "border-border hover:bg-accent",
                  )}
                >
                  <span className="block text-sm font-semibold">Custom</span>
                  <span className="block text-[11px] text-muted-foreground">40–120 mm</span>
                </button>
              </div>
              {useCustom ? (
                <div className="flex items-center gap-2 pt-1">
                  <Input
                    type="number"
                    min={40}
                    max={120}
                    value={customWidth}
                    onChange={(event) => setCustomWidth(event.target.value)}
                    className="h-9 w-28"
                    aria-label="Custom paper width in millimetres"
                  />
                  <span className="text-sm text-muted-foreground">mm wide</span>
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label>What to print</Label>
              <div className="grid gap-2">
                {SCOPES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setScope(option.value)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition",
                      scope === option.value
                        ? "border-primary bg-primary/10 font-medium"
                        : "border-border hover:bg-accent",
                    )}
                  >
                    <option.icon className="size-4" />
                    {option.label}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {(() => {
                        const count =
                          option.value === "ORDER"
                            ? 1
                            : option.value === "GARMENTS"
                              ? sheet.garments.length
                              : sheet.garments.length + 1;
                        return `${count} tag${count === 1 ? "" : "s"}`;
                      })()}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Button onClick={() => runPrint(false)} disabled={pending}>
                <Printer /> Print tag
              </Button>
              <Button variant="outline" onClick={() => runPrint(true)} disabled={pending}>
                <RotateCcw /> Reprint tag
              </Button>
              <Button variant="outline" onClick={printAll} disabled={pending}>
                <Layers /> Print all tags
              </Button>
              <Button variant="ghost" onClick={() => setPreviewOpen(true)}>
                <Eye /> Print preview
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Tags print black-on-white with no margins at {effectiveWidth} mm. Set your
              printer to the same roll width and disable headers and footers.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="mb-3 text-sm font-medium">
              Preview · actual size at {effectiveWidth} mm
            </p>
            <div className="flex flex-wrap gap-4 overflow-x-auto rounded-lg bg-[#e9eaf0] p-4">
              {tags.map((tag) => (
                <div
                  key={tag.key}
                  className="thermal-sheet shrink-0 border border-neutral-300 shadow-sm"
                >
                  {tag.node}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* The live sheet the browser actually prints: one continuous column. */}
      <div className="thermal-sheet thermal-print-root" aria-hidden>
        {tags.map((tag) => (
          <div key={`print-${tag.key}`}>{tag.node}</div>
        ))}
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Print preview</DialogTitle>
            <DialogDescription>
              {tags.length} tag{tags.length === 1 ? "" : "s"} at {effectiveWidth} mm, exactly
              as they will come off the roll.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 rounded-lg bg-[#e9eaf0] p-4">
            {tags.map((tag) => (
              <div key={`dlg-${tag.key}`} className="thermal-sheet border border-neutral-300">
                {tag.node}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                setPreviewOpen(false);
                requestAnimationFrame(() => runPrint(printCount > 0));
              }}
            >
              <Printer /> Print now
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
