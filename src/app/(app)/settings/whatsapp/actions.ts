"use server";

import { revalidatePath } from "next/cache";
import { requireFirmId, requirePermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import {
  connectWhatsAppSession,
  disconnectWhatsAppSession,
  getWhatsAppStatus,
  reconnectWhatsAppSession,
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
    const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const state = await connectWhatsAppSession(requireFirmId(user));
    revalidatePath("/settings/whatsapp");
    return { ok: true, data: state };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to connect WhatsApp session" };
  }
}

export async function refreshWhatsAppAction() {
  try {
    const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const state = await getWhatsAppStatus(requireFirmId(user), { forceRefresh: true });
    revalidatePath("/settings/whatsapp");
    return { ok: true, data: state };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to refresh WhatsApp status" };
  }
}

export async function reconnectWhatsAppAction() {
  try {
    const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const state = await reconnectWhatsAppSession(requireFirmId(user));
    revalidatePath("/settings/whatsapp");
    return { ok: true, data: state };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to reconnect WhatsApp session" };
  }
}

export async function disconnectWhatsAppAction() {
  try {
    const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const state = await disconnectWhatsAppSession(requireFirmId(user));
    revalidatePath("/settings/whatsapp");
    return { ok: true, data: state };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to disconnect WhatsApp session" };
  }
}

export async function saveTemplateAction(code: WhatsAppMessageType, name: string, body: string) {
  try {
    const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const template = await saveWhatsAppTemplate(requireFirmId(user), code, name, body);
    revalidatePath("/settings/whatsapp");
    return { ok: true, data: template };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to save WhatsApp template" };
  }
}
