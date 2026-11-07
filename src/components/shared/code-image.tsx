"use client";

import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";

import { cn } from "@/lib/utils";

interface QrCodeProps {
  value: string;
  size?: number;
  className?: string;
  label?: string;
}

/** Renders a QR code entirely client-side — no round trip, no image host. */
export function QrCode({ value, size = 128, className, label }: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#111827", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return (
    <div className={cn("inline-flex flex-col items-center gap-1", className)}>
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={dataUrl}
          alt={`QR code for ${value}`}
          width={size}
          height={size}
          className="rounded bg-white p-1"
        />
      ) : (
        <div
          className="animate-pulse rounded bg-muted"
          style={{ width: size, height: size }}
        />
      )}
      {label ? (
        <span className="font-mono text-xs text-muted-foreground">{label}</span>
      ) : null}
    </div>
  );
}

interface BarcodeProps {
  value: string;
  className?: string;
  height?: number;
  displayValue?: boolean;
}

export function Barcode({
  value,
  className,
  height = 48,
  displayValue = true,
}: BarcodeProps) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, {
        format: "CODE128",
        height,
        displayValue,
        fontSize: 12,
        margin: 4,
        lineColor: "#111827",
        background: "#ffffff",
      });
    } catch {
      // An unencodable value simply renders nothing rather than crashing.
    }
  }, [value, height, displayValue]);

  return <svg ref={ref} className={cn("max-w-full rounded bg-white", className)} />;
}
