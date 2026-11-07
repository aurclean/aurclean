import { NextResponse } from "next/server";
import { requireFirmId, requirePermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import {
  connectWhatsAppSession,
  disconnectWhatsAppSession,
  getWhatsAppStatus,
  reconnectWhatsAppSession,
  sendWhatsAppMessage,
} from "@/lib/services/whatsapp";

export const dynamic = "force-dynamic";

/**
 * WhatsApp Session Control REST API Endpoint
 */
export async function GET(req: Request) {
  try {
    const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const { searchParams } = new URL(req.url);
    const forceRefresh = searchParams.get("refresh") === "true";

    const session = await getWhatsAppStatus(requireFirmId(user), { forceRefresh });
    return NextResponse.json({ ok: true, data: session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch session status";
    const isAuth = message.includes("Unauthorized") || message.includes("Forbidden") || message.includes("Permission");
    return NextResponse.json(
      { ok: false, error: message },
      { status: isAuth ? 401 : 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const firmId = requireFirmId(user);
    const body = await req.json().catch(() => ({}));
    const action = body?.action || "connect";

    let session;
    if (action === "disconnect") {
      session = await disconnectWhatsAppSession(firmId);
    } else if (action === "reconnect") {
      session = await reconnectWhatsAppSession(firmId);
    } else if (action === "refresh") {
      session = await getWhatsAppStatus(firmId, { forceRefresh: true });
    } else if (action === "test") {
      const phone = body?.phone;
      if (!phone) {
        return NextResponse.json({ ok: false, error: "Phone number required for test" }, { status: 400 });
      }
      const testRes = await sendWhatsAppMessage({
        firmId,
        phone,
        messageType: "CUSTOM",
        messageText: "Test WhatsApp message from AURCLEAN Laundry ERP. Gateway connection verified successfully!",
        sentByUserId: user.id,
      });
      return NextResponse.json({ ok: true, data: testRes });
    } else {
      session = await connectWhatsAppSession(firmId);
    }

    return NextResponse.json({ ok: true, data: session });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WhatsApp Session Action Failed";
    const isAuth = message.includes("Unauthorized") || message.includes("Forbidden") || message.includes("Permission");
    return NextResponse.json(
      { ok: false, error: message },
      { status: isAuth ? 401 : 500 },
    );
  }
}
