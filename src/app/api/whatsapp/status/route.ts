import { NextResponse } from "next/server";
import { requireFirmId, requirePermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import { getWhatsAppStatus } from "@/lib/services/whatsapp";

export const dynamic = "force-dynamic";

/**
 * Real Connection Status API Endpoint: GET /api/whatsapp/status
 * Queries live ground-truth state directly from OpenWA and returns normalized session status.
 */
export async function GET(req: Request) {
  try {
    const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const { searchParams } = new URL(req.url);
    const forceRefresh = searchParams.get("refresh") === "true";

    const statusData = await getWhatsAppStatus(requireFirmId(user), { forceRefresh });
    return NextResponse.json(statusData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to query WhatsApp status";
    const isAuth = message.includes("Unauthorized") || message.includes("Forbidden") || message.includes("Permission");

    return NextResponse.json(
      {
        success: false,
        provider: "openwa",
        connected: false,
        status: isAuth ? "action_required" : "erp_unavailable",
        phoneNumber: null,
        sessionId: null,
        qrCode: null,
        erpOk: !isAuth,
        openWaOk: false,
        error: message,
        lastCheckedAt: new Date().toISOString(),
      },
      { status: isAuth ? 401 : 500 },
    );
  }
}
