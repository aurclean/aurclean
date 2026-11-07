import { PERMISSIONS } from "@/lib/rbac";
import { requireFirmId, requirePermission } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getWhatsAppStatus, getWhatsAppTemplates } from "@/lib/services/whatsapp";
import { WhatsAppSettingsView } from "./whatsapp-settings-view";

export const metadata = { title: "WhatsApp Gateway Settings" };

export default async function WhatsAppSettingsPage() {
  const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
  const firmId = requireFirmId(user);

  const [firm, statusData, templates] = await Promise.all([
    prisma.firm.findUniqueOrThrow({ where: { id: firmId }, select: { name: true } }),
    getWhatsAppStatus(firmId, { forceRefresh: true }),
    getWhatsAppTemplates(firmId),
  ]);

  return <WhatsAppSettingsView firmName={firm.name} initialStatusData={statusData} templates={templates} />;
}
