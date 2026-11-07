/**
 * Garment tag payloads. A scanned code is resolved server-side, so the payload
 * only needs to be stable, unique and easy for a camera to read.
 */
export const QR_PREFIX = "AURA";

export function buildQrPayload(garmentCode: string): string {
  return `${QR_PREFIX}:G:${garmentCode}`;
}

export function buildBarcodeValue(garmentCode: string): string {
  // CODE128 handles alphanumerics, so the garment code doubles as the barcode.
  return garmentCode;
}

export interface ParsedScan {
  kind: "garment" | "order" | "unknown";
  value: string;
}

/**
 * Accepts raw scanner output in any of the forms the app produces, plus plain
 * codes typed by hand at the counter.
 */
export function parseScan(raw: string): ParsedScan {
  const input = raw.trim();
  if (!input) return { kind: "unknown", value: "" };

  const upper = input.toUpperCase();

  if (upper.startsWith(`${QR_PREFIX}:`)) {
    const [, kind, value] = upper.split(":");
    if (kind === "G" && value) return { kind: "garment", value };
    if (kind === "O" && value) return { kind: "order", value };
    return { kind: "unknown", value: upper };
  }

  // TR-1042 and friends, plus the legacy G1001 form.
  if (/^[A-Z]{2}-\d+$/.test(upper)) return { kind: "garment", value: upper };
  if (/^G\d+$/.test(upper)) return { kind: "garment", value: upper };
  if (/^ORD\d+$/.test(upper)) return { kind: "order", value: upper };

  return { kind: "unknown", value: upper };
}

export function buildOrderQrPayload(orderNumber: string): string {
  return `${QR_PREFIX}:O:${orderNumber}`;
}
