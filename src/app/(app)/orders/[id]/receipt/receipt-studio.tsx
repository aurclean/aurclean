"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Printer, Tag as TagIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Barcode, QrCode } from "@/components/shared/code-image";
import { formatCurrency } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { TagSheet } from "@/lib/services/tags";

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  ONLINE: "Online",
  BANK_TRANSFER: "Bank transfer",
  CREDIT: "Credit",
  OTHER: "Other",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PAID: "PAID",
  PARTIALLY_PAID: "PARTIAL",
  UNPAID: "UNPAID",
  REFUNDED: "REFUNDED",
  PARTIALLY_REFUNDED: "PARTIALLY REFUNDED",
};

export function ReceiptStudio({ sheet }: { sheet: TagSheet }) {
  const [widthMm, setWidthMm] = useState(80);
  const [customWidth, setCustomWidth] = useState("70");
  const [useCustom, setUseCustom] = useState(false);

  const effectiveWidth = useCustom
    ? Math.min(120, Math.max(40, Number(customWidth) || 80))
    : widthMm;

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `@media print { @page { size: ${effectiveWidth}mm auto; margin: 0; } }`;
    document.head.append(style);
    return () => style.remove();
  }, [effectiveWidth]);

  const print = () => {
    document.body.dataset.printMode = "thermal";
    window.print();
    delete document.body.dataset.printMode;
  };

  const receipt = <Receipt sheet={sheet} widthMm={effectiveWidth} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Receipt for {sheet.orderNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            {sheet.payments.length} payment{sheet.payments.length === 1 ? "" : "s"} ·{" "}
            {formatCurrency(sheet.paidAmount)} of {formatCurrency(sheet.totalAmount)}{" "}
            collected
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/orders/${sheet.orderId}`}>
              <ArrowLeft /> Back to order
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/orders/${sheet.orderId}/tags`}>
              <TagIcon /> Print tags
            </Link>
          </Button>
          <Button onClick={print}>
            <Printer /> Print receipt
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)] no-print">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <Label>Paper width</Label>
            <div className="grid grid-cols-3 gap-2">
              {[58, 80].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setUseCustom(false);
                    setWidthMm(preset);
                  }}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm font-semibold transition",
                    !useCustom && widthMm === preset
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-accent",
                  )}
                >
                  {preset} mm
                </button>
              ))}
              <button
                type="button"
                onClick={() => setUseCustom(true)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm font-semibold transition",
                  useCustom ? "border-primary bg-primary/10" : "border-border hover:bg-accent",
                )}
              >
                Custom
              </button>
            </div>
            {useCustom ? (
              <div className="flex items-center gap-2">
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
            <p className="text-xs text-muted-foreground">
              A GST receipt for the customer. It prints separately from the bundle tag so
              the counter can hand one over without reprinting the other.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="mb-3 text-sm font-medium">
              Preview · actual size at {effectiveWidth} mm
            </p>
            <div className="flex justify-center rounded-lg bg-[#e9eaf0] p-4">
              <div className="thermal-sheet border border-neutral-300 shadow-sm">
                {receipt}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="thermal-sheet thermal-print-root" aria-hidden>
        {receipt}
      </div>
    </div>
  );
}

function Receipt({ sheet, widthMm }: { sheet: TagSheet; widthMm: number }) {
  const k = widthMm >= 70 ? 1 : 0.84;

  return (
    <div className="thermal-tag" style={{ width: `${widthMm}mm`, fontSize: `${9 * k}pt` }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: `${12 * k}pt`, fontWeight: 800, letterSpacing: "0.04em" }}>
          {sheet.businessName.toUpperCase()}
        </div>
        <div style={{ fontSize: `${7.5 * k}pt` }}>{sheet.branchName}</div>
        {sheet.branchAddress ? (
          <div style={{ fontSize: `${7 * k}pt` }}>{sheet.branchAddress}</div>
        ) : null}
        {sheet.branchPhone ? (
          <div style={{ fontSize: `${7 * k}pt` }}>Ph {sheet.branchPhone}</div>
        ) : null}
        {sheet.gstNumber ? (
          <div style={{ fontSize: `${7 * k}pt` }}>GSTIN {sheet.gstNumber}</div>
        ) : null}
      </div>

      <hr className="thermal-rule" />
      <div style={{ textAlign: "center", fontSize: `${8 * k}pt`, letterSpacing: "0.16em" }}>
        TAX INVOICE
      </div>
      <hr className="thermal-rule" />

      <div className="thermal-row">
        <span>Order</span>
        <span style={{ fontWeight: 800, fontSize: `${11 * k}pt` }}>{sheet.orderNumber}</span>
      </div>
      <div className="thermal-row">
        <span>Date</span>
        <span>{formatDateTime(sheet.placedAt)}</span>
      </div>
      <div className="thermal-row">
        <span>Delivery</span>
        <span>{formatDate(sheet.expectedDeliveryAt)}</span>
      </div>
      <div className="thermal-row">
        <span>Customer</span>
        <span style={{ fontWeight: 700 }}>{sheet.customerName}</span>
      </div>
      <div className="thermal-row">
        <span>Phone</span>
        <span>{sheet.customerPhone}</span>
      </div>

      <hr className="thermal-rule" />

      {sheet.items.map((item) => (
        <div key={item.id} style={{ marginBottom: "1mm" }}>
          <div style={{ fontWeight: 700 }}>{item.label}</div>
          <div className="thermal-row" style={{ fontSize: `${8 * k}pt` }}>
            <span>
              {item.weightKg > 0
                ? `${item.weightKg} kg × ${formatCurrency(item.unitPrice)}`
                : `${item.quantity} × ${formatCurrency(item.unitPrice)}`}
            </span>
            <span>{formatCurrency(item.lineTotal)}</span>
          </div>
        </div>
      ))}

      <hr className="thermal-rule" />

      <div className="thermal-row">
        <span>Subtotal</span>
        <span>{formatCurrency(sheet.subtotal)}</span>
      </div>
      {sheet.discountAmount > 0 ? (
        <div className="thermal-row">
          <span>Discount</span>
          <span>− {formatCurrency(sheet.discountAmount)}</span>
        </div>
      ) : null}
      <div className="thermal-row">
        <span>GST @ {sheet.gstRate}%</span>
        <span>{formatCurrency(sheet.gstAmount)}</span>
      </div>
      <div
        className="thermal-row"
        style={{ fontSize: `${12 * k}pt`, fontWeight: 800, marginTop: "1mm" }}
      >
        <span>TOTAL</span>
        <span>{formatCurrency(sheet.totalAmount)}</span>
      </div>

      <hr className="thermal-rule" />

      {sheet.payments.length > 0 ? (
        <>
          <div style={{ fontSize: `${7 * k}pt`, letterSpacing: "0.12em" }}>PAYMENTS</div>
          {sheet.payments.map((payment) => (
            <div className="thermal-row" key={payment.id}>
              <span>
                {formatDate(payment.paidAt)} · {METHOD_LABELS[payment.method] ?? payment.method}
              </span>
              <span>{formatCurrency(payment.amount)}</span>
            </div>
          ))}
        </>
      ) : (
        <div style={{ fontSize: `${8 * k}pt` }}>No payment collected yet.</div>
      )}

      <div className="thermal-row" style={{ marginTop: "1mm" }}>
        <span>Paid</span>
        <span style={{ fontWeight: 700 }}>{formatCurrency(sheet.paidAmount)}</span>
      </div>
      <div className="thermal-row" style={{ fontSize: `${11 * k}pt`, fontWeight: 800 }}>
        <span>BALANCE</span>
        <span>{formatCurrency(sheet.outstandingAmount)}</span>
      </div>

      <hr className="thermal-rule" />

      {sheet.payments.length > 0 ? (
        <div className="thermal-row">
          <span>Payment</span>
          <span>
            {[...new Set(sheet.payments.map((p) => METHOD_LABELS[p.method] ?? p.method))].join(
              " / ",
            )}
          </span>
        </div>
      ) : null}
      <div className="thermal-row" style={{ fontWeight: 700 }}>
        <span>Status</span>
        <span>{PAYMENT_STATUS_LABELS[sheet.paymentStatus] ?? sheet.paymentStatus}</span>
      </div>

      <hr className="thermal-rule" />

      <div style={{ display: "flex", justifyContent: "center", marginTop: "1mm" }}>
        <QrCode value={sheet.orderQr} size={widthMm >= 70 ? 108 : 88} />
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Barcode value={sheet.orderBarcode} height={widthMm >= 70 ? 30 : 24} />
      </div>

      <div style={{ textAlign: "center", fontSize: `${8 * k}pt`, fontWeight: 600, marginTop: "2mm" }}>
        Thank you for choosing AURCLEAN
      </div>
    </div>
  );
}
