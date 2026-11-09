"use server";

import { revalidatePath } from "next/cache";
import { requireFirmId, requirePermission } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac";
import {
  connectWhatsAppSession,
  disconnectWhatsAppSession,
  getWhatsAppStatus,
  reconnectWhatsAppSession,
  refreshQrCode,
  saveWhatsAppTemplate,
  sendWhatsAppMessage,
  type SendWhatsAppParams,
} from "@/lib/services/whatsapp";
import type { WhatsAppMessageType } from "@/generated/prisma/client";

export async function sendWhatsAppAction(params: Omit<SendWhatsAppParams, "firmId">) {
  try {
    const user = await requirePermission(PERMISSIONS.ORDER_VIEW);
    const res = await sendWhatsAppMessage({ ...params, firmId: requireFirmId(user), sentByUserId: user.id });
    return { ok: true, data: res };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to send WhatsApp message" };
  }
}

export async function connectWhatsAppAction() {
  try {
    const user = await requirePermission(PERMISSIONS.WHATSAPP_MANAGE);
    const state = await connectWhatsAppSession(requireFirmId(user));
    revalidatePath("/settings/whatsapp");
    return { ok: true, data: state };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to connect WhatsApp session" };
  }
}

export async function refreshWhatsAppAction() {
  try {
    const user = await requirePermission(PERMISSIONS.WHATSAPP_MANAGE);
    const state = await getWhatsAppStatus(requireFirmId(user), { forceRefresh: true });
    revalidatePath("/settings/whatsapp");
    return { ok: true, data: state };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to refresh WhatsApp status" };
  }
}

export async function reconnectWhatsAppAction() {
  try {
    const user = await requirePermission(PERMISSIONS.WHATSAPP_MANAGE);
    const state = await reconnectWhatsAppSession(requireFirmId(user));
    revalidatePath("/settings/whatsapp");
    return { ok: true, data: state };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to reconnect WhatsApp session" };
  }
}

export async function disconnectWhatsAppAction() {
  try {
    const user = await requirePermission(PERMISSIONS.WHATSAPP_MANAGE);
    const state = await disconnectWhatsAppSession(requireFirmId(user));
    revalidatePath("/settings/whatsapp");
    return { ok: true, data: state };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to disconnect WhatsApp session" };
  }
}

export async function saveTemplateAction(code: WhatsAppMessageType, name: string, body: string) {
  try {
    const user = await requirePermission(PERMISSIONS.WHATSAPP_MANAGE);
    const template = await saveWhatsAppTemplate(requireFirmId(user), code, name, body);
    revalidatePath("/settings/whatsapp");
    return { ok: true, data: template };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to save WhatsApp template" };
  }
}

export async function refreshQrAction() {
  try {
    const user = await requirePermission(PERMISSIONS.WHATSAPP_MANAGE);
    const state = await refreshQrCode(requireFirmId(user));
    revalidatePath("/settings/whatsapp");
    return { ok: true, data: state };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to refresh the QR code" };
  }
}

/** Test message text is composed here, on the server, with this firm's own name. */
export async function sendTestMessageAction(phone: string) {
  try {
    const user = await requirePermission(PERMISSIONS.WHATSAPP_MANAGE);
    const firmId = requireFirmId(user);
    const firm = await prisma.firm.findUniqueOrThrow({ where: { id: firmId }, select: { name: true } });
    const res = await sendWhatsAppMessage({
      firmId,
      phone,
      messageType: "CUSTOM",
      messageText: `Test message from ${firm.name}: this WhatsApp number is connected.`,
      sentByUserId: user.id,
    });
    revalidatePath("/settings/whatsapp");
    return { ok: true, data: res };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.replace(/\s*\[FALLBACK_URL:[^\]]*\]/, "") : "Failed to send the test message" };
  }
}
