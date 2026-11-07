import "server-only";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { formatWhatsAppPhone, interpolateWhatsAppTemplate } from "@/lib/whatsapp-templates";
import type { WhatsAppMessageStatus, WhatsAppMessageType } from "@/generated/prisma/client";

export { formatWhatsAppPhone, interpolateWhatsAppTemplate };

// Server-only OpenWA environment configuration. No fallback secret: an
// unconfigured OPENWA_API_KEY must fail closed (both for the outgoing
// gateway calls below, which the real OpenWA server will then reject, and
// for the inbound webhook in the route that imports this), never silently
// authenticate with a guessable hardcoded string.
const OPENWA_BASE_URL = (process.env.OPENWA_BASE_URL || process.env.OPENWA_API_URL || "http://localhost:8080").replace(/\/$/, "");
export const OPENWA_API_KEY = process.env.OPENWA_API_KEY || "";

/**
 * Maps an OpenWA HTTP status code to a message staff can act on, so a 401
 * (bad API key) doesn't read the same as a 429 (rate limited, try again) or
 * a 500 (gateway's own fault). Falls back to whatever the gateway itself
 * said, since that's more specific than a generic per-code message.
 */
function describeOpenWaError(status: number, gatewayMessage?: string | null): string {
  switch (status) {
    case 401:
    case 403:
      return "WhatsApp gateway authentication failed. Check the configured OpenWA API key.";
    case 404:
      return "WhatsApp session not found on the gateway. It may need to be reconnected.";
    case 409:
      return "WhatsApp session is not ready. Connect WhatsApp in Settings before sending.";
    case 413:
      return "Document is too large to send over WhatsApp.";
    case 429:
      return "WhatsApp gateway rate limit reached. Please try again shortly.";
    case 500:
      return "WhatsApp gateway encountered an internal error.";
    case 503:
    case 504:
      return "WhatsApp gateway is unreachable. Confirm the OpenWA service is running.";
    default:
      return gatewayMessage || `WhatsApp gateway returned an unexpected error (HTTP ${status}).`;
  }
}

export type OpenWaSessionStatus =
  | "initializing"
  | "qr_ready"
  | "authenticating"
  | "ready"
  | "disconnected"
  | "failed"
  | "not_configured"
  | "stopped"
  | "action_required"
  | "openwa_unavailable"
  | "erp_unavailable";

export interface SendWhatsAppParams {
  firmId: string;
  phone: string;
  messageType: WhatsAppMessageType;
  messageText: string;
  customerId?: string;
  orderId?: string;
  documentName?: string;
  documentType?: string;
  documentId?: string;
  documentBase64?: string;
  sentByUserId?: string;
}

export interface WhatsAppStatusResponse {
  success: boolean;
  provider: "openwa";
  firmId: string;
  connected: boolean;
  status: OpenWaSessionStatus;
  phoneNumber: string | null;
  sessionId: string | null;
  qrCode: string | null;
  erpOk: boolean;
  openWaOk: boolean;
  error: string | null;
  lastCheckedAt: string;
  lastConnectedAt: string | null;
  openWaUrl: string;
}

/** Default message templates for AURCLEAN ERP */
const DEFAULT_TEMPLATES: Record<WhatsAppMessageType, { name: string; body: string }> = {
  ORDER_CREATED: {
    name: "Order Confirmation",
    body: "Hi {{customerName}},\n\nThank you for choosing {{businessName}}. Your order #{{orderId}} has been placed successfully.\nTotal Amount: {{total}}\nExpected Delivery: {{deliveryDate}}\n\nThank you,\n{{businessName}}",
  },
  ORDER_READY: {
    name: "Order Ready Notification",
    body: "Hi {{customerName}},\n\nYour {{businessName}} laundry order #{{orderId}} is ready for collection.\n\nTotal: {{total}}\nPaid: {{paid}}\nBalance Due: {{balance}}\n\nThank you,\n{{businessName}}",
  },
  PAYMENT_RECEIVED: {
    name: "Payment Receipt",
    body: "Hi {{customerName}},\n\nPayment Received for Order #{{orderId}}.\nAmount Paid: {{paid}}\nRemaining Balance: {{balance}}\n\nThank you for your payment,\n{{businessName}}",
  },
  PAYMENT_PENDING: {
    name: "Payment Reminder",
    body: "Hi {{customerName}},\n\nReminder: Your {{businessName}} order #{{orderId}} has an outstanding balance of {{balance}}.\n\nPlease complete payment at your earliest convenience.\n\nThank you,\n{{businessName}}",
  },
  ORDER_DELIVERED: {
    name: "Delivery Confirmation",
    body: "Hi {{customerName}},\n\nYour order #{{orderId}} has been delivered successfully. Thank you for using {{businessName}}!\n\nWe hope to serve you again soon.",
  },
  INVOICE: {
    name: "WhatsApp Invoice",
    body: "Hi {{customerName}},\n\nThank you for choosing {{businessName}}.\n\nInvoice #{{invoiceNumber}}\nOrder #{{orderId}}\nTotal: {{total}}\nPaid: {{paid}}\nBalance: {{balance}}\n\nPlease find your invoice attached.\n\nThank you,\n{{businessName}}",
  },
  PAYMENT_RECEIPT: {
    name: "WhatsApp Payment Receipt",
    body: "Hi {{customerName}},\n\nPayment Receipt #{{invoiceNumber}}\nOrder #{{orderId}}\nAmount Paid: {{paid}}\nRemaining Balance: {{balance}}\n\nPlease find your payment receipt attached.\n\nThank you,\n{{businessName}}",
  },
  DELIVERY_RECEIPT: {
    name: "WhatsApp Delivery Receipt",
    body: "Hi {{customerName}},\n\nDelivery Receipt for Order #{{orderId}}.\nTotal Amount: {{total}}\nBalance: {{balance}}\n\nPlease find your delivery receipt attached.\n\nThank you for choosing {{businessName}}",
  },
  DELIVERY_CHALLAN: {
    name: "WhatsApp Delivery Challan",
    body: "Hello {{customerName}},\n\nPlease find your {{businessName}} Delivery Challan attached.\n\nChallan No: {{challanNumber}}\nOrder No: {{orderId}}\nDelivery Date: {{deliveryDate}}\n\nThank you,\n{{businessName}}",
  },
  CUSTOM: {
    name: "Custom Message",
    body: "Hi {{customerName}},\n\n{{messageText}}\n\nRegards,\n{{businessName}}",
  },
};

/**
 * Executes a secure server-side HTTP fetch call to OpenWA API
 */
async function fetchOpenWa(
  endpoint: string,
  options: {
    method?: "GET" | "POST" | "DELETE" | "PUT";
    body?: any;
    timeoutMs?: number;
  } = {},
): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const url = endpoint.startsWith("http") ? endpoint : `${OPENWA_BASE_URL}${endpoint}`;

  try {
    const res = await fetch(url, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": OPENWA_API_KEY,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timer);

    const text = await res.text();
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data,
        error: data?.message || data?.error || data?.reason || `HTTP ${res.status}`,
      };
    }

    return { ok: true, status: res.status, data };
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      return { ok: false, status: 504, data: null, error: `OpenWA request timeout (${timeoutMs}ms)` };
    }
    return { ok: false, status: 503, data: null, error: err?.message || "Unable to connect to OpenWA service" };
  }
}

const SESSION_PROVIDER = "openwa";

/** Deterministic gateway session id for a firm. Never shared, never global. */
export function sessionIdForFirm(firmId: string): string {
  return `wa_${firmId}`;
}

async function getOrCreateFirmSession(firmId: string) {
  return prisma.whatsAppSession.upsert({
    where: { firmId_provider: { firmId, provider: SESSION_PROVIDER } },
    create: { firmId, provider: SESSION_PROVIDER, sessionName: sessionIdForFirm(firmId) },
    update: {},
  });
}

function formatConnectedPhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/@.*$/, "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.length === 10 ? `+91 ${digits}` : `+${digits}`;
}

function baseStatus(firmId: string, patch: Partial<WhatsAppStatusResponse>): WhatsAppStatusResponse {
  return {
    success: true,
    provider: "openwa",
    firmId,
    connected: false,
    status: "not_configured",
    phoneNumber: null,
    sessionId: null,
    qrCode: null,
    erpOk: true,
    openWaOk: true,
    error: null,
    lastCheckedAt: new Date().toISOString(),
    lastConnectedAt: null,
    openWaUrl: OPENWA_BASE_URL,
    ...patch,
  };
}

/**
 * Queries the live state of THIS firm's gateway session. "Connected" is only
 * ever reported when the gateway itself says its status is exactly "ready" —
 * a database row, a reachable gateway, or a past send never imply it.
 */
export async function getWhatsAppStatus(firmId: string, _options?: { forceRefresh?: boolean }): Promise<WhatsAppStatusResponse> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return baseStatus(firmId, { success: false, status: "erp_unavailable", erpOk: false, openWaOk: false, error: "ERP database connection failure" });
  }

  const row = await getOrCreateFirmSession(firmId);
  const sessionId = row.sessionName;
  const checkedAt = new Date();

  const persist = (data: { isConnected: boolean; connectedNumber: string | null; apiStatus: string; lastConnectedAt?: Date | null }) =>
    prisma.whatsAppSession
      .update({ where: { id: row.id }, data: { ...data, qrCode: null, lastCheckedAt: checkedAt } })
      .catch((err) => console.warn("WhatsApp session cache sync failed:", err?.message));

  const res = await fetchOpenWa(`/api/sessions/${encodeURIComponent(sessionId)}`, { timeoutMs: 5000 });

  if (!res.ok && (res.status === 503 || res.status === 504)) {
    await persist({ isConnected: false, connectedNumber: null, apiStatus: "OPENWA_UNAVAILABLE" });
    return baseStatus(firmId, {
      status: "openwa_unavailable",
      sessionId,
      openWaOk: false,
      error: `Unable to reach the OpenWA service at ${OPENWA_BASE_URL}`,
      lastConnectedAt: row.lastConnectedAt?.toISOString() ?? null,
    });
  }

  if (!res.ok && res.status === 404) {
    // Gateway has no session by this id: never started, or its login was cleared.
    const status: OpenWaSessionStatus = row.lastConnectedAt ? "stopped" : "not_configured";
    await persist({ isConnected: false, connectedNumber: null, apiStatus: status.toUpperCase() });
    return baseStatus(firmId, { status, sessionId, lastConnectedAt: row.lastConnectedAt?.toISOString() ?? null });
  }

  if (!res.ok) {
    await persist({ isConnected: false, connectedNumber: null, apiStatus: "FAILED" });
    return baseStatus(firmId, {
      status: "failed",
      sessionId,
      error: describeOpenWaError(res.status, res.error),
      lastConnectedAt: row.lastConnectedAt?.toISOString() ?? null,
    });
  }

  const raw = String(res.data?.status ?? "").toLowerCase();
  const known: Record<string, OpenWaSessionStatus> = {
    ready: "ready",
    qr_ready: "qr_ready",
    authenticating: "authenticating",
    initializing: "initializing",
    starting: "initializing",
    disconnected: "disconnected",
    stopped: "stopped",
    failed: "failed",
  };
  const status: OpenWaSessionStatus = known[raw] ?? "failed";
  const connected = status === "ready";
  const phone = connected ? formatConnectedPhone(res.data?.phoneNumber) : null;
  const connectedAt = connected && res.data?.lastConnectedAt ? new Date(res.data.lastConnectedAt) : row.lastConnectedAt;

  let qrCode: string | null = null;
  if (status === "qr_ready" && typeof res.data?.qrCode === "string") {
    qrCode = res.data.qrCode.startsWith("data:") ? res.data.qrCode : `data:image/png;base64,${res.data.qrCode}`;
  }

  await persist({
    isConnected: connected,
    connectedNumber: phone,
    apiStatus: status.toUpperCase(),
    ...(connected ? { lastConnectedAt: connectedAt } : {}),
  });

  return baseStatus(firmId, {
    connected,
    status,
    phoneNumber: phone,
    sessionId,
    qrCode,
    lastConnectedAt: connectedAt?.toISOString() ?? null,
    error: raw && !known[raw] ? `Unrecognised gateway status "${raw}"` : null,
  });
}

/** Starts (or resumes) this firm's own gateway session; a QR is issued if it is not yet paired. */
export async function connectWhatsAppSession(firmId: string): Promise<WhatsAppStatusResponse> {
  const { sessionName } = await getOrCreateFirmSession(firmId);
  await fetchOpenWa("/api/sessions", { method: "POST", body: { sessionId: sessionName }, timeoutMs: 8000 });
  return getWhatsAppStatus(firmId);
}

/** Logs this firm's session out (clearing its paired login) and starts a fresh one. */
export async function reconnectWhatsAppSession(firmId: string): Promise<WhatsAppStatusResponse> {
  const { sessionName } = await getOrCreateFirmSession(firmId);
  await fetchOpenWa(`/api/sessions/${encodeURIComponent(sessionName)}/logout`, { method: "POST", timeoutMs: 5000 });
  return connectWhatsAppSession(firmId);
}

/** Logs out ONLY this firm's session. Other firms' sessions are untouched. */
export async function disconnectWhatsAppSession(firmId: string): Promise<WhatsAppStatusResponse> {
  const { sessionName } = await getOrCreateFirmSession(firmId);
  await fetchOpenWa(`/api/sessions/${encodeURIComponent(sessionName)}/logout`, { method: "POST", timeoutMs: 5000 });
  return getWhatsAppStatus(firmId);
}

/** Live WhatsApp status for every firm, for the Super Admin overview. */
export async function getAllFirmsWhatsAppStatus() {
  const firms = await prisma.firm.findMany({ select: { id: true, name: true, code: true, status: true }, orderBy: { name: "asc" } });
  return Promise.all(firms.map(async (firm) => ({ firm, whatsapp: await getWhatsAppStatus(firm.id) })));
}

/**
 * Sends a text or document through the given firm's own WhatsApp session. The
 * session is resolved from firmId alone; there is no fallback to any other.
 */
export async function sendWhatsAppMessage(params: SendWhatsAppParams): Promise<{
  success: boolean;
  messageId: string;
  status: WhatsAppMessageStatus;
  whatsappWebUrl?: string;
  error?: string;
}> {
  const formattedPhone = formatWhatsAppPhone(params.phone);
  if (!formattedPhone) {
    throw new Error("Invalid phone number provided for WhatsApp message delivery.");
  }

  // Manual fallback so staff can still reach the customer; never implies the gateway sent anything.
  const whatsappWebUrl = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(params.messageText)}`;

  const current = await getWhatsAppStatus(params.firmId);
  if (!current.connected || current.status !== "ready" || !current.sessionId) {
    throw new Error(
      `WhatsApp is not connected for this firm (Status: ${current.status}). Please connect WhatsApp in Settings. [FALLBACK_URL:${whatsappWebUrl}]`,
    );
  }

  const sessionId = current.sessionId;
  const isDocument = Boolean(params.documentBase64);
  const payload = isDocument
    ? { to: formattedPhone, filename: params.documentName || "document.pdf", caption: params.messageText, file: params.documentBase64 }
    : { to: formattedPhone, text: params.messageText };

  const sendRes = await fetchOpenWa(`/api/sessions/${encodeURIComponent(sessionId)}/${isDocument ? "files" : "messages"}`, {
    method: "POST",
    body: payload,
    timeoutMs: 12000,
  });

  let status: WhatsAppMessageStatus = "SENT";
  let externalId: string | null = null;
  let errorMessage: string | null = null;
  if (sendRes.ok) {
    externalId = sendRes.data?.id || sendRes.data?.messageId || null;
  } else {
    status = "FAILED";
    errorMessage = describeOpenWaError(sendRes.status, sendRes.error);
  }

  const log = await prisma.whatsAppLog.create({
    data: {
      firmId: params.firmId,
      sessionId,
      phone: params.phone,
      messageType: params.messageType,
      messageText: params.messageText,
      documentName: params.documentName || null,
      documentUrl: params.documentName ? `/api/files/whatsapp/${params.documentName}` : null,
      documentType: params.documentType || null,
      documentId: params.documentId || null,
      status,
      externalId,
      errorMessage,
      customerId: params.customerId || null,
      orderId: params.orderId || null,
      sentByUserId: params.sentByUserId || null,
    },
  });

  if (params.sentByUserId) {
    await recordAudit({
      userId: params.sentByUserId,
      action: "WHATSAPP_MESSAGE_SENT",
      entity: "WhatsAppLog",
      entityId: log.id,
      summary: `Sent WhatsApp ${params.messageType} to ${params.phone} (${status})`,
    });
  }

  if (status === "FAILED") {
    throw new Error(`${errorMessage || "Failed to dispatch message via OpenWA Gateway."} [FALLBACK_URL:${whatsappWebUrl}]`);
  }

  return { success: true, messageId: log.id, status: log.status, whatsappWebUrl };
}

/** Retrieves or initializes templates in database */
export async function getWhatsAppTemplates(firmId: string) {
  const existing = await prisma.whatsAppTemplate.findMany({
    where: { firmId },
    orderBy: { code: "asc" },
  });

  if (existing.length === 0) {
    const seeded = await Promise.all(
      Object.entries(DEFAULT_TEMPLATES).map(([code, tpl]) =>
        prisma.whatsAppTemplate.create({
          data: {
            firmId,
            code: code as WhatsAppMessageType,
            name: tpl.name,
            body: tpl.body,
            isActive: true,
          },
        }),
      ),
    );
    return seeded;
  }

  return existing;
}

/** Saves/updates a message template */
export async function saveWhatsAppTemplate(firmId: string, code: WhatsAppMessageType, name: string, body: string) {
  return prisma.whatsAppTemplate.upsert({
    where: { firmId_code: { firmId, code } },
    create: {
      firmId,
      code,
      name,
      body,
      isActive: true,
    },
    update: {
      name,
      body,
      isActive: true,
    },
  });
}

/** This firm's message history, optionally narrowed to a customer or order. */
export async function getWhatsAppHistory(
  firmId: string,
  params: { customerId?: string; orderId?: string; take?: number } = {},
) {
  return prisma.whatsAppLog.findMany({
    where: {
      firmId,
      ...(params.customerId ? { customerId: params.customerId } : {}),
      ...(params.orderId ? { orderId: params.orderId } : {}),
    },
    orderBy: { sentAt: "desc" },
    take: params.take || 50,
    include: {
      sentByUser: { select: { id: true, name: true, role: true } },
      order: { select: { id: true, orderNumber: true } },
      customer: { select: { id: true, name: true, phone: true } },
    },
  });
}

/**
 * Handles gateway callbacks. The payload's sessionId identifies the session,
 * the session identifies the firm, and everything is processed under that
 * firm only — a callback for an unknown session is ignored.
 */
export async function handleWhatsAppWebhook(payload: {
  event?: string;
  sessionId?: string;
  messageId?: string;
  status?: string;
  phoneNumber?: string | null;
}) {
  if (!payload.sessionId) return { updated: false, reason: "sessionId required" };

  const session = await prisma.whatsAppSession.findUnique({ where: { sessionName: payload.sessionId } });
  if (!session) return { updated: false, reason: "unknown session" };

  if (payload.event === "session.status") {
    const connected = payload.status === "ready";
    await prisma.whatsAppSession.update({
      where: { id: session.id },
      data: {
        isConnected: connected,
        apiStatus: String(payload.status ?? "").toUpperCase() || session.apiStatus,
        connectedNumber: connected ? formatConnectedPhone(payload.phoneNumber) : null,
        lastCheckedAt: new Date(),
        ...(connected ? { lastConnectedAt: new Date() } : {}),
      },
    });
    return { updated: true, firmId: session.firmId };
  }

  if (payload.event === "message.ack" && payload.messageId) {
    const newStatus: WhatsAppMessageStatus =
      payload.status === "READ" ? "READ" : payload.status === "FAILED" ? "FAILED" : "DELIVERED";
    const result = await prisma.whatsAppLog.updateMany({
      where: { firmId: session.firmId, externalId: payload.messageId },
      data: { status: newStatus },
    });
    return { updated: result.count > 0, status: newStatus };
  }

  return { updated: false };
}
