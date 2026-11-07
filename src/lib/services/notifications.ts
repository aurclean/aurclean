import "server-only";
import { prisma } from "@/lib/prisma";
import { getTransport, renderTemplate } from "@/lib/providers/notifications";
import {
  DEFAULT_NOTIFICATION_BODIES as DEFAULT_BODIES,
  NOTIFICATION_EVENT_LABELS,
} from "@/lib/notification-templates";
import type {
  NotificationChannel,
  NotificationEvent,
} from "@/generated/prisma/enums";

export interface NotifyInput {
  event: NotificationEvent;
  orderId?: string | null;
  branchId?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  recipientEmail?: string | null;
  variables: Record<string, string | number | null | undefined>;
  /** Restrict to specific channels; defaults to every active template. */
  channels?: NotificationChannel[];
}


function recipientFor(
  channel: NotificationChannel,
  input: NotifyInput,
): string | null {
  if (channel === "EMAIL") return input.recipientEmail ?? null;
  return input.recipientPhone ?? null;
}

/**
 * Queues a notification per active template, renders it, then attempts
 * delivery. Every attempt is written to NotificationLog so the trail is
 * Order → Notification → Channel → Status → Timestamp.
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const templates = await prisma.notificationTemplate.findMany({
      where: {
        event: input.event,
        isActive: true,
        ...(input.channels ? { channel: { in: input.channels } } : {}),
      },
    });

    const variables = {
      brand: process.env.APP_NAME ?? "Aura Laundry",
      ...input.variables,
    };

    const targets =
      templates.length > 0
        ? templates.map((template) => ({
            templateId: template.id as string | null,
            channel: template.channel,
            subject: template.subject,
            body: renderTemplate(template.body, variables),
          }))
        : (input.channels ?? ["IN_APP"]).map((channel) => ({
            templateId: null,
            channel,
            subject: null as string | null,
            body: renderTemplate(DEFAULT_BODIES[input.event], variables),
          }));

    for (const target of targets) {
      const to = recipientFor(target.channel, input);
      if (!to) continue;

      const notification = await prisma.notification.create({
        data: {
          event: input.event,
          channel: target.channel,
          templateId: target.templateId,
          orderId: input.orderId ?? null,
          branchId: input.branchId ?? null,
          recipientName: input.recipientName ?? null,
          recipientPhone: input.recipientPhone ?? null,
          recipientEmail: input.recipientEmail ?? null,
          subject: target.subject,
          body: target.body,
          payload: variables as never,
          status: "QUEUED",
          logs: { create: { status: "QUEUED", detail: "Queued for dispatch" } },
        },
      });

      const result = await getTransport(target.channel).send({
        channel: target.channel,
        to,
        subject: target.subject,
        body: target.body,
      });

      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: result.success ? "SENT" : "FAILED",
          providerMessageId: result.providerMessageId ?? null,
          errorMessage: result.error ?? null,
          sentAt: result.success ? new Date() : null,
          retryCount: { increment: result.success ? 0 : 1 },
          logs: {
            create: {
              status: result.success ? "SENT" : "FAILED",
              detail: result.success
                ? `Accepted by provider${result.providerMessageId ? ` (${result.providerMessageId})` : ""}`
                : (result.error ?? "Delivery failed"),
            },
          },
        },
      });
    }
  } catch (error) {
    // A failed customer message must never roll back the operation that
    // triggered it — orders, payments and deliveries come first.
    console.error("[notifications] dispatch failed", error);
  }
}

/** Retries a previously failed or queued notification. */
export async function resendNotification(notificationId: string): Promise<boolean> {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  });
  if (!notification) return false;

  const to =
    notification.channel === "EMAIL"
      ? notification.recipientEmail
      : notification.recipientPhone;
  if (!to) return false;

  const result = await getTransport(notification.channel).send({
    channel: notification.channel,
    to,
    subject: notification.subject,
    body: notification.body,
  });

  await prisma.notification.update({
    where: { id: notification.id },
    data: {
      status: result.success ? "SENT" : "FAILED",
      providerMessageId: result.providerMessageId ?? null,
      errorMessage: result.error ?? null,
      sentAt: result.success ? new Date() : notification.sentAt,
      retryCount: { increment: 1 },
      logs: {
        create: {
          status: result.success ? "SENT" : "FAILED",
          detail: result.success ? "Resent successfully" : (result.error ?? "Resend failed"),
        },
      },
    },
  });

  return result.success;
}

export { NOTIFICATION_EVENT_LABELS, DEFAULT_BODIES as DEFAULT_NOTIFICATION_BODIES };
