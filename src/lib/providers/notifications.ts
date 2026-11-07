import "server-only";
import type { NotificationChannel } from "@/generated/prisma/enums";

export interface OutboundMessage {
  channel: NotificationChannel;
  to: string;
  subject?: string | null;
  body: string;
  templateCode?: string | null;
  variables?: Record<string, string>;
}

export interface DispatchResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface NotificationTransport {
  readonly channel: NotificationChannel;
  send(message: OutboundMessage): Promise<DispatchResult>;
}

/**
 * In-app delivery. The application deliberately does not talk to WhatsApp or
 * SMS gateways: a message on this channel is stored, shown in the notification
 * centre and read out or printed at the counter. Nothing leaves the building,
 * so there is no gateway to configure and nothing to fail.
 */
class InAppTransport implements NotificationTransport {
  readonly channel: NotificationChannel = "IN_APP";

  async send(message: OutboundMessage): Promise<DispatchResult> {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[notifications:in-app] → ${message.to}\n${message.body}`);
    }
    return {
      success: true,
      providerMessageId: `inapp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
  }
}

/** Transactional email over the Resend HTTP API. */
class EmailTransport implements NotificationTransport {
  readonly channel: NotificationChannel = "EMAIL";

  async send(message: OutboundMessage): Promise<DispatchResult> {
    const apiKey = process.env.EMAIL_API_KEY;
    const from = process.env.EMAIL_FROM;

    if (!apiKey || !from) {
      return { success: false, error: "Email credentials are not configured" };
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject ?? "Notification",
          text: message.body,
        }),
      });

      const data = (await response.json()) as { id?: string; message?: string };
      if (!response.ok) {
        return { success: false, error: data.message ?? `HTTP ${response.status}` };
      }
      return { success: true, providerMessageId: data.id };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
}

const transports = new Map<NotificationChannel, NotificationTransport>();

/**
 * Email is the only channel that reaches outside, and it stays inert until
 * EMAIL_API_KEY and EMAIL_FROM are set — so a deployment with no messaging
 * credentials at all is a fully working deployment.
 */
export function getTransport(channel: NotificationChannel): NotificationTransport {
  const cached = transports.get(channel);
  if (cached) return cached;

  const emailEnabled =
    Boolean(process.env.EMAIL_API_KEY) && Boolean(process.env.EMAIL_FROM);

  const transport: NotificationTransport =
    channel === "EMAIL" && emailEnabled ? new EmailTransport() : new InAppTransport();

  transports.set(channel, transport);
  return transport;
}

/** Replaces {{placeholders}} in a template body. */
export function renderTemplate(
  template: string,
  variables: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key];
    return value === null || value === undefined ? "" : String(value);
  });
}
