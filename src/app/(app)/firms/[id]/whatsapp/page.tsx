import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { getWhatsAppStatus } from "@/lib/services/whatsapp";
import { waLabel } from "@/lib/whatsapp-status";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "WhatsApp status" };
export const dynamic = "force-dynamic";

/** Status only. The QR, linking controls and message history belong to the Firm Manager. */
export default async function FirmWhatsAppPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission(PERMISSIONS.FIRM_VIEW);
  const { id } = await params;
  const firm = await prisma.firm.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!firm) notFound();

  const live = await getWhatsAppStatus(firm.id);
  const session = await prisma.whatsAppSession.findUnique({ where: { firmId_provider: { firmId: firm.id, provider: "openwa" } }, select: { lastConnectedAt: true, lastError: true } });
  const label = waLabel(live.status);

  const rows: Array<[string, string]> = [
    ["Firm", firm.name],
    ["Status", live.connected ? "Connected" : label.label === "Connected" ? "Disconnected" : label.label],
    ["Connected number", live.connected ? (live.phoneNumber ?? "Number unavailable") : "—"],
    ["Last connected", session?.lastConnectedAt ? formatDateTime(session.lastConnectedAt) : "Never"],
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="WhatsApp status" description="Read from this firm's own WhatsApp session. The firm links, unlinks and sends from its own WhatsApp settings." />
      <Card className="border-emerald-900/15">
        <CardContent className="divide-y p-0">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 px-4 py-3 text-sm">
              <span className="text-muted-foreground">{k}</span>
              <span className="inline-flex items-center gap-2 font-medium">
                {k === "Status" ? <span className={`size-2 rounded-full ${label.dot}`} /> : null}{v}
              </span>
            </div>
          ))}
          {live.error || session?.lastError ? <p className="px-4 py-3 text-sm text-destructive">Last error: {live.error ?? session?.lastError}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
