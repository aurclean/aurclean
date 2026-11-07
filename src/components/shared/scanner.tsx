"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Camera, CameraOff, Loader2, ScanLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ScannerProps {
  /** Called with the raw scanned/typed value and which input produced it. */
  onScan: (value: string, source: "keyboard" | "camera") => void | Promise<void>;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  disabled?: boolean;
  /** Ignore repeat reads of the same code for this many ms. */
  debounceMs?: number;
  /**
   * "compact" is the small inline scanner used on workstation screens.
   * "workstation" is the large, full-attention scan surface for /scan: a
   * prominent Start/Stop Scanner button, an animated scanning frame, and a
   * live status line, with the keyboard/hardware-scanner input always ready
   * underneath.
   */
  variant?: "compact" | "workstation";
}

/**
 * Dual-mode garment scanner.
 *
 * Keyboard mode is the default because hardware barcode guns behave like
 * keyboards and are what most counters use; camera mode covers phones and
 * tablets on the shop floor. Both funnel into the same `onScan` callback.
 * 
 * Supports continuous / unlimited camera scanning without shutting down
 * between scans.
 */
export function Scanner({
  onScan,
  placeholder = "Scan or type a garment code (e.g. G1001)",
  autoFocus = true,
  className,
  disabled,
  debounceMs = 1200,
  variant = "compact",
}: ScannerProps) {
  const [mode, setMode] = useState<"keyboard" | "camera">("keyboard");
  const [cameraStarting, setCameraStarting] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerInstanceRef = useRef<any>(null);
  const onScanRef = useRef(onScan);

  // Keep latest onScan function in a ref so scan callbacks never cause camera re-initialisation
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const rawId = useId();
  const regionId = `scanner_region_${rawId.replace(/[^a-zA-Z0-9]/g, "_")}`;

  const submit = useCallback(
    async (raw: string, source: "keyboard" | "camera" = "keyboard") => {
      const code = raw.trim();
      if (!code || disabled) return;

      const now = Date.now();
      if (
        lastScanRef.current.code === code &&
        now - lastScanRef.current.at < debounceMs
      ) {
        return;
      }
      lastScanRef.current = { code, at: now };
      setLastScannedCode(code);

      setBusy(true);
      try {
        await onScanRef.current(code, source);
      } catch (err) {
        console.error("Scan handler error:", err);
      } finally {
        setBusy(false);
        setValue("");
        inputRef.current?.focus();
      }
    },
    [disabled, debounceMs],
  );

  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  // Camera lifecycle. The camera runs continuously and is only started or
  // stopped when `mode` or `selectedCameraId` explicitly changes.
  useEffect(() => {
    if (mode !== "camera") return;

    let cancelled = false;
    setCameraError(null);
    setCameraStarting(true);

    const startCamera = async () => {
      try {
        if (
          typeof navigator === "undefined" ||
          !navigator.mediaDevices ||
          !navigator.mediaDevices.getUserMedia
        ) {
          throw new Error("Camera API is not supported in this browser or context.");
        }

        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;

        // Ensure DOM container exists
        const container = document.getElementById(regionId);
        if (!container) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (cancelled) return;
        }

        // Clean up any lingering previous instance before starting fresh
        if (scannerInstanceRef.current) {
          try {
            if (scannerInstanceRef.current.isScanning) {
              await scannerInstanceRef.current.stop();
            }
            scannerInstanceRef.current.clear();
          } catch {
            // Ignore teardown errors of previous instance
          }
          scannerInstanceRef.current = null;
        }

        if (cancelled) return;

        let targetCamera: string | { facingMode: string } = selectedCameraId
          ? selectedCameraId
          : { facingMode: "environment" };

        try {
          const devices = await Html5Qrcode.getCameras();
          if (!cancelled && devices && devices.length > 0) {
            setCameras(devices);
            if (!selectedCameraId) {
              const rear = devices.find((d) => /back|rear|environment/i.test(d.label));
              const chosen = (rear ?? devices[devices.length - 1]).id;
              targetCamera = chosen;
            }
          }
        } catch {
          targetCamera = { facingMode: "environment" };
        }

        if (cancelled) return;

        const instance = new Html5Qrcode(regionId, {
          verbose: false,
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true,
          },
        });
        scannerInstanceRef.current = instance;

        await instance.start(
          targetCamera,
          {
            fps: 15,
            qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
              const minDim = Math.min(viewfinderWidth, viewfinderHeight);
              const size = Math.floor(minDim * 0.75);
              return { width: Math.max(160, Math.min(size, 280)), height: Math.max(160, Math.min(size, 280)) };
            },
            aspectRatio: 1.0,
          },
          (decoded) => {
            if (!cancelled && decoded) {
              // Submit using the latest ref without restarting the stream
              void submitRef.current(decoded, "camera");
            }
          },
          () => {
            // Frame miss is standard behavior
          },
        );

        if (!cancelled) {
          setCameraStarting(false);
        }
      } catch (error) {
        if (!cancelled) {
          setCameraStarting(false);
          const message = error instanceof Error ? error.message : String(error);
          setCameraError(
            /permission|notallowed|denied/i.test(message)
              ? "Camera access was denied. Please allow camera permissions in your browser and try again."
              : /notfound|no camera/i.test(message)
                ? "No camera was found on this device."
                : "Unable to start camera stream. Check camera permissions or switch to manual input.",
          );
          setMode("keyboard");
        }
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      const instance = scannerInstanceRef.current;
      scannerInstanceRef.current = null;
      if (instance) {
        try {
          if (instance.isScanning) {
            instance
              .stop()
              .then(() => {
                try {
                  instance.clear();
                } catch {
                  // Ignore cleanup errors
                }
              })
              .catch(() => {
                // Ignore stop errors on unmount
              });
          } else {
            try {
              instance.clear();
            } catch {
              // Ignore cleanup errors
            }
          }
        } catch {
          // Ignore sync errors
        }
      }
    };
  }, [mode, selectedCameraId, regionId]);

  const handleCameraChange = (cameraId: string) => {
    setSelectedCameraId(cameraId);
  };

  const keyboardInput = (
    <div className="flex gap-2">
      <form
        className="relative flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(value, "keyboard");
        }}
      >
        <Input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled || busy}
          autoComplete="off"
          spellCheck={false}
          className="h-12 pr-10 font-mono text-base uppercase"
          aria-label="Garment code"
        />
        {busy ? (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </form>
      {variant === "compact" ? (
        <Button
          type="button"
          variant={mode === "camera" ? "default" : "outline"}
          size="icon"
          className="h-12 w-12 shrink-0"
          onClick={() => setMode((m) => (m === "camera" ? "keyboard" : "camera"))}
          aria-label={mode === "camera" ? "Switch to keyboard entry" : "Scan with camera"}
          disabled={disabled}
        >
          {mode === "camera" ? <ScanLine /> : <Camera />}
        </Button>
      ) : null}
    </div>
  );

  if (variant === "workstation") {
    return (
      <div className={cn("space-y-3", className)}>
        <div
          className={cn(
            "relative flex min-h-[260px] items-center justify-center overflow-hidden rounded-2xl border-2 transition-colors",
            mode === "camera"
              ? "border-primary/40 bg-black"
              : "border-dashed border-border bg-muted/30",
          )}
        >
          {mode === "camera" ? (
            <>
              <div id={regionId} className="w-full max-w-sm overflow-hidden" suppressHydrationWarning />
              {!cameraStarting ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="scan-frame relative size-56 max-w-[70%]">
                    <span className="scan-frame-corner scan-frame-corner-tl" />
                    <span className="scan-frame-corner scan-frame-corner-tr" />
                    <span className="scan-frame-corner scan-frame-corner-bl" />
                    <span className="scan-frame-corner scan-frame-corner-br" />
                    <span className="scan-frame-laser" />
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white bg-black/80">
                  <Loader2 className="size-6 animate-spin text-primary" />
                  <p className="text-sm">Starting camera stream…</p>
                </div>
              )}
              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 z-10">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setMode("keyboard")}
                >
                  <CameraOff /> Stop Scanner
                </Button>
                {cameras.length > 1 ? (
                  <select
                    aria-label="Choose camera"
                    className="h-8 rounded-md border border-border bg-secondary px-2 text-xs font-medium text-secondary-foreground"
                    value={selectedCameraId ?? ""}
                    onChange={(event) => handleCameraChange(event.target.value)}
                  >
                    {cameras.map((camera) => (
                      <option key={camera.id} value={camera.id}>
                        {camera.label || `Camera ${camera.id.slice(0, 6)}`}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <span className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                <ScanLine className="size-8" />
              </span>
              <div>
                <p className="font-medium">Continuous Scanner Ready</p>
                <p className="text-sm text-muted-foreground">
                  Start camera stream for uninterrupted continuous scanning, or scan/type below.
                </p>
              </div>
              <Button type="button" size="lg" onClick={() => setMode("camera")} disabled={disabled}>
                <Camera /> Start Scanner
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-1.5 text-xs font-medium px-1">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "size-2 rounded-full",
                mode === "camera" ? "animate-pulse bg-emerald-500" : "bg-muted-foreground/40",
              )}
              aria-hidden
            />
            <span className="text-muted-foreground">
              {mode === "camera"
                ? cameraStarting
                  ? "Initializing camera stream…"
                  : "Live camera scanner active (unlimited continuous scan)"
                : "Hardware barcode / keyboard input ready"}
            </span>
          </div>
          {lastScannedCode ? (
            <span className="font-mono text-muted-foreground text-[11px]">
              Last read: <strong className="text-foreground">{lastScannedCode}</strong>
            </span>
          ) : null}
        </div>

        {keyboardInput}

        {cameraError ? (
          <p className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 p-2.5 rounded-lg border border-destructive/20">
            <CameraOff className="size-3.5 shrink-0" /> {cameraError}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {keyboardInput}

      {mode === "camera" ? (
        <div className="overflow-hidden rounded-lg border border-border bg-black/90 p-2">
          <div id={regionId} className="mx-auto w-full max-w-sm" suppressHydrationWarning />
        </div>
      ) : null}

      {cameraError ? (
        <p className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 p-2.5 rounded-lg border border-destructive/20">
          <CameraOff className="size-3.5 shrink-0" /> {cameraError}
        </p>
      ) : null}
    </div>
  );
}
