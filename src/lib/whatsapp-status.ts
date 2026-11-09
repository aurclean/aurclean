/** Client-safe labels for a firm's WhatsApp session state (spec status rules). */
export type WaStatusKey =
  | "ready" | "qr_ready" | "initializing" | "authenticating" | "disconnected" | "failed" | "stopped"
  | "not_configured" | "openwa_unavailable" | "erp_unavailable" | "action_required";

export const WA_STATUS: Record<WaStatusKey, { label: string; dot: string }> = {
  ready: { label: "Connected", dot: "bg-emerald-500" },
  qr_ready: { label: "Scan QR", dot: "bg-amber-500" },
  initializing: { label: "Connecting", dot: "bg-sky-500" },
  authenticating: { label: "Authenticating", dot: "bg-sky-500" },
  disconnected: { label: "Disconnected", dot: "bg-muted-foreground" },
  failed: { label: "Connection Failed", dot: "bg-rose-500" },
  stopped: { label: "Stopped", dot: "bg-muted-foreground" },
  not_configured: { label: "Not connected", dot: "bg-muted-foreground" },
  openwa_unavailable: { label: "Gateway unreachable", dot: "bg-rose-500" },
  erp_unavailable: { label: "Database unavailable", dot: "bg-rose-500" },
  action_required: { label: "Action required", dot: "bg-amber-500" },
};

export function waLabel(status: string) {
  return WA_STATUS[status as WaStatusKey] ?? { label: status, dot: "bg-muted-foreground" };
}
