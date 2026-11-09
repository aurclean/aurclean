import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { getAllFirmsWhatsAppStatus } from "@/lib/services/whatsapp";
import { waLabel } from "@/lib/whatsapp-status";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "WhatsApp overview" };
export const dynamic = "force-dynamic";

/**
 * Connection status only. The platform admin never sees a firm's QR code or
 * message content here — a firm connects its own number from its own
 * WhatsApp Settings page.
 */
export default async function PlatformWhatsAppPage() {
  await requirePermission(PERMISSIONS.PLATFORM_VIEW);
  const [live, sessions] = await Promise.all([
    getAllFirmsWhatsAppStatus(),
    prisma.whatsAppSession.findMany({ select: { firmId: true, sessionName: true, lastConnectedAt: true, lastError: true } }),
  ]);
  const meta = new Map(sessions.map((s) => [s.firmId, s]));

  return (
    <div className="space-y-5">
      <PageHeader title="WhatsApp overview" description="Each firm has its own independent WhatsApp session and number." />
      <Card>
        <CardContent className="divide-y p-0">
          {live.map(({ firm, whatsapp }) => {
            const label = waLabel(whatsapp.status);
            const m = meta.get(firm.id);
            return (
              <div key={firm.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <div>
                  <p className="font-medium">{firm.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{m?.sessionName ?? "no session yet"}</p>
                </div>
                <div className="text-right">
                  <p className="inline-flex items-center gap-1.5"><span className={`size-2 rounded-full ${label.dot}`} />{label.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {whatsapp.connected ? (whatsapp.phoneNumber ?? "number unavailable") : "—"}
                    {m?.lastConnectedAt ? ` · last connected ${formatDateTime(m.lastConnectedAt)}` : ""}
                  </p>
                  {whatsapp.error || m?.lastError ? <p className="text-xs text-destructive">{whatsapp.error ?? m?.lastError}</p> : null}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
