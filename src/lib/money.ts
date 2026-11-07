import { Prisma } from "@/generated/prisma/client";

export type Decimalish = Prisma.Decimal | number | string | null | undefined;

/** Convert any Prisma Decimal / numeric-ish value into a plain number. */
export function num(value: Decimalish): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseFloat(value) || 0;
  return value.toNumber();
}

/** Round to 2 decimal places, avoiding float drift. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(value: Decimalish): string {
  return inrFormatter.format(num(value));
}

export function formatCompactCurrency(value: Decimalish): string {
  const n = num(value);
  if (Math.abs(n) >= 10000000) return `₹${round2(n / 10000000)}Cr`;
  if (Math.abs(n) >= 100000) return `₹${round2(n / 100000)}L`;
  if (Math.abs(n) >= 1000) return `₹${round2(n / 1000)}K`;
  return formatCurrency(n);
}

export function formatNumber(value: Decimalish, fractionDigits = 0): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(num(value));
}

export interface LineTotalsInput {
  subtotal: number;
  discountAmount: number;
  gstRate: number;
}

export interface OrderTotals {
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  gstRate: number;
  gstAmount: number;
  totalAmount: number;
}

/**
 * Single source of truth for order/invoice arithmetic.
 * Discount applies to the subtotal; GST applies to the discounted (taxable) value.
 */
export function computeTotals({
  subtotal,
  discountAmount,
  gstRate,
}: LineTotalsInput): OrderTotals {
  const safeSubtotal = round2(Math.max(0, subtotal));
  const safeDiscount = round2(Math.min(Math.max(0, discountAmount), safeSubtotal));
  const taxableAmount = round2(safeSubtotal - safeDiscount);
  const gstAmount = round2((taxableAmount * Math.max(0, gstRate)) / 100);
  const totalAmount = round2(taxableAmount + gstAmount);

  return {
    subtotal: safeSubtotal,
    discountAmount: safeDiscount,
    taxableAmount,
    gstRate,
    gstAmount,
    totalAmount,
  };
}

/** Split GST into CGST/SGST (intra-state) or IGST (inter-state). */
export function splitGst(gstAmount: number, interState: boolean) {
  if (interState) {
    return { cgstAmount: 0, sgstAmount: 0, igstAmount: round2(gstAmount) };
  }
  const half = round2(gstAmount / 2);
  return {
    cgstAmount: half,
    sgstAmount: round2(gstAmount - half),
    igstAmount: 0,
  };
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

function threeDigitsToWords(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)]);
    n %= 10;
  }
  if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(" ");
}

/** Indian numbering (Crore/Lakh/Thousand) — the convention used on Indian invoices. */
function integerToIndianWords(value: number): string {
  if (value === 0) return "Zero";

  const crore = Math.floor(value / 10000000);
  value %= 10000000;
  const lakh = Math.floor(value / 100000);
  value %= 100000;
  const thousand = Math.floor(value / 1000);
  value %= 1000;
  const hundred = value;

  const segments: string[] = [];
  if (crore > 0) segments.push(`${threeDigitsToWords(crore)} Crore`);
  if (lakh > 0) segments.push(`${threeDigitsToWords(lakh)} Lakh`);
  if (thousand > 0) segments.push(`${threeDigitsToWords(thousand)} Thousand`);
  if (hundred > 0) segments.push(threeDigitsToWords(hundred));

  return segments.join(" ");
}

/**
 * Spells out a rupee amount for the "Amount in Words" line on printed
 * documents, e.g. 796 -> "Seven Hundred Ninety Six Rupees Only" and
 * 1250.50 -> "One Thousand Two Hundred Fifty Rupees And Fifty Paise Only".
 */
export function amountInWords(value: Decimalish): string {
  const amount = round2(Math.max(0, num(value)));
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);

  const rupeeWords = `${integerToIndianWords(rupees)} Rupee${rupees === 1 ? "" : "s"}`;
  if (paise === 0) return `${rupeeWords} Only`;

  const paiseWords = `${integerToIndianWords(paise)} Paise`;
  return `${rupeeWords} And ${paiseWords} Only`;
}

export function derivePaymentStatus(
  totalAmount: number,
  paidAmount: number,
  refundedAmount = 0,
): "UNPAID" | "PARTIALLY_PAID" | "PAID" | "REFUNDED" | "PARTIALLY_REFUNDED" {
  if (refundedAmount > 0) {
    return refundedAmount >= paidAmount && paidAmount > 0
      ? "REFUNDED"
      : "PARTIALLY_REFUNDED";
  }
  if (paidAmount <= 0) return "UNPAID";
  if (round2(paidAmount) >= round2(totalAmount)) return "PAID";
  return "PARTIALLY_PAID";
}
