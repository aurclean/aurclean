"use client";

import { Barcode, QrCode } from "@/components/shared/code-image";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import type { TagSheet } from "@/lib/services/tags";

/** Roughly what a 58mm / 80mm roll can actually print inside its margins. */
export function printableWidth(widthMm: number): number {
  return Math.max(30, widthMm - 10);
}

interface TagProps {
  sheet: TagSheet;
  widthMm: number;
  reprint?: boolean;
}

const scale = (widthMm: number) => (widthMm >= 70 ? 1 : 0.84);

/**
 * The order tag — the one that goes on the bundle. Everything the counter needs
 * to hand the order back without opening the system: who it belongs to, what is
 * in it, when it is due and what is still owed.
 */
export function OrderTag({ sheet, widthMm, reprint = false }: TagProps) {
  const k = scale(widthMm);
  const inner = printableWidth(widthMm);

  return (
    <div className="thermal-tag" style={{ width: `${widthMm}mm`, fontSize: `${9 * k}pt` }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: `${11 * k}pt`, fontWeight: 700, letterSpacing: "0.04em" }}>
          {sheet.businessName.toUpperCase()}
        </div>
        <div style={{ fontSize: `${7.5 * k}pt` }}>
          {sheet.branchName} ({sheet.branchCode})
        </div>
        {sheet.branchPhone ? (
          <div style={{ fontSize: `${7.5 * k}pt` }}>{sheet.branchPhone}</div>
        ) : null}
      </div>

      <hr className="thermal-rule" />

      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: `${7 * k}pt`, letterSpacing: "0.12em" }}>ORDER ID</div>
        <div
          style={{
            fontSize: `${widthMm >= 70 ? 22 : 17}pt`,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: "0.02em",
          }}
        >
          {sheet.orderNumber}
        </div>
        <div style={{ fontSize: `${7.5 * k}pt`, textTransform: "uppercase" }}>
          {sheet.statusLabel}
          {sheet.priority !== "NORMAL" ? ` · ${sheet.priority}` : ""}
          {reprint ? " · REPRINT" : ""}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          marginTop: "1.5mm",
        }}
      >
        <QrCode value={sheet.orderQr} size={widthMm >= 70 ? 132 : 104} />
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Barcode
          value={sheet.orderBarcode}
          height={widthMm >= 70 ? 34 : 28}
          className="max-w-full"
        />
      </div>

      <hr className="thermal-rule" />

      <div className="thermal-row">
        <span>Customer</span>
        <span style={{ fontWeight: 700, textAlign: "right" }}>{sheet.customerName}</span>
      </div>
      <div className="thermal-row">
        <span>Phone</span>
        <span style={{ fontWeight: 700 }}>{sheet.customerPhone}</span>
      </div>
      <div className="thermal-row">
        <span>Booked</span>
        <span>{formatDate(sheet.placedAt)}</span>
      </div>
      <div className="thermal-row">
        <span>Delivery</span>
        <span style={{ fontWeight: 700 }}>{formatDate(sheet.expectedDeliveryAt)}</span>
      </div>
      <div className="thermal-row">
        <span>Pieces</span>
        <span style={{ fontWeight: 700 }}>
          {sheet.pieceCount} in {sheet.itemCount} line{sheet.itemCount === 1 ? "" : "s"}
        </span>
      </div>
      <hr className="thermal-rule" />

      <div style={{ fontSize: `${7 * k}pt`, letterSpacing: "0.12em" }}>ITEMS</div>
      {sheet.items.map((item) => (
        <div className="thermal-row" key={item.id}>
          <span style={{ maxWidth: `${inner * 0.62}mm` }}>
            {item.quantity}× {item.label}
          </span>
          <span>{formatCurrency(item.lineTotal)}</span>
        </div>
      ))}

      <hr className="thermal-rule" />

      <div className="thermal-row">
        <span>Total</span>
        <span style={{ fontWeight: 700 }}>{formatCurrency(sheet.totalAmount)}</span>
      </div>
      <div className="thermal-row">
        <span>Paid</span>
        <span>{formatCurrency(sheet.paidAmount)}</span>
      </div>
      <div
        className="thermal-row"
        style={{ fontSize: `${11 * k}pt`, fontWeight: 800, marginTop: "0.5mm" }}
      >
        <span>BALANCE</span>
        <span>{formatCurrency(sheet.outstandingAmount)}</span>
      </div>

      {sheet.specialInstructions ? (
        <>
          <hr className="thermal-rule" />
          <div style={{ fontSize: `${7 * k}pt`, letterSpacing: "0.12em" }}>
            INSTRUCTIONS
          </div>
          <div style={{ fontSize: `${8 * k}pt` }}>{sheet.specialInstructions}</div>
        </>
      ) : null}

      <hr className="thermal-rule" />
      <div style={{ textAlign: "center", fontSize: `${7 * k}pt` }}>
        Show this tag when collecting · {sheet.branchCode}/{sheet.orderNumber}
      </div>
    </div>
  );
}

/** A per-piece tag. Small, and readable by a scanner from the garment itself. */
export function GarmentTag({
  sheet,
  widthMm,
  garment,
  index,
}: TagProps & { garment: TagSheet["garments"][number]; index: number }) {
  const k = scale(widthMm);

  return (
    <div className="thermal-tag" style={{ width: `${widthMm}mm`, fontSize: `${9 * k}pt` }}>
      <div className="thermal-row" style={{ fontSize: `${7.5 * k}pt` }}>
        <span>{sheet.businessName}</span>
        <span>
          {index + 1}/{sheet.garments.length}
        </span>
      </div>
      <div
        style={{
          fontSize: `${widthMm >= 70 ? 18 : 15}pt`,
          fontWeight: 800,
          lineHeight: 1.1,
          textAlign: "center",
        }}
      >
        {garment.garmentCode}
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <QrCode value={garment.qrPayload} size={widthMm >= 70 ? 108 : 88} />
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Barcode value={garment.barcodeValue} height={widthMm >= 70 ? 30 : 24} />
      </div>
      <hr className="thermal-rule" />
      <div className="thermal-row">
        <span>{garment.garmentTypeName}</span>
        <span>{garment.serviceName}</span>
      </div>
      <div className="thermal-row">
        <span>Order</span>
        <span style={{ fontWeight: 700 }}>{sheet.orderNumber}</span>
      </div>
      <div className="thermal-row">
        <span>{sheet.customerName}</span>
        <span>{sheet.customerPhone}</span>
      </div>
      <div className="thermal-row">
        <span>Due</span>
        <span style={{ fontWeight: 700 }}>{formatDate(sheet.expectedDeliveryAt)}</span>
      </div>
    </div>
  );
}
