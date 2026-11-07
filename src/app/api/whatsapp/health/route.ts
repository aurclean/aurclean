import { NextResponse } from "next/server";
import { requireFirmId, requirePermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import { getWhatsAppStatus } from "@/lib/services/whatsapp";

export const dynamic = "force-dynamic";

/**
 * Health Check API for WhatsApp Integration
 * Returns health status of ERP database, OpenWA Gateway service, and active Session
 */
export async function GET() {
  try {
    const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
    const health = await getWhatsAppStatus(requireFirmId(user), { forceRefresh: true });
    const status = health.erpOk && health.openWaOk ? 200 : 503;
    return NextResponse.json(health, { status });
  } catch (error) {
    return NextResponse.json(
      {
        erpOk: false,
        openWaOk: false,
        error: error instanceof Error ? error.message : "ERP Health Check Failed",
      },
      { status: 500 },
    );
  }
}
