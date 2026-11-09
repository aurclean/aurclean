import { PERMISSIONS } from "@/lib/rbac";
import { requireFirmId, requirePermission } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getWhatsAppHistory, getWhatsAppStatus, getWhatsAppTemplates } from "@/lib/services/whatsapp";
import { formatDateTime } from "@/lib/dates";
import { RefreshQrButton } from "./refresh-qr-button";
import { WhatsAppSettingsView } from "./whatsapp-settings-view";

export const metadata = { title: "WhatsApp Gateway Settings" };

export default async function WhatsAppSettingsPage() {
  const user = await requirePermission(PERMISSIONS.WHATSAPP_MANAGE);
  const firmId = requireFirmId(user);

  const [firm, statusData, templates, history, session] = await Promise.all([
    prisma.firm.findUniqueOrThrow({ where: { id: firmId }, select: { name: true } }),
    getWhatsAppStatus(firmId, { forceRefresh: true }),
    getWhatsAppTemplates(firmId),
    getWhatsAppHistory(firmId, { take: 25 }),
    prisma.whatsAppSession.findUnique({ where: { firmId_provider: { firmId, provider: "openwa" } }, select: { lastConnectedAt: true, lastError: true, sessionName: true } }),
  ]);

  return (
    <div className="space-y-6">
      <WhatsAppSettingsView firmName={firm.name} initialStatusData={statusData} templates={templates} />

      <section className="space-y-2 rounded-xl border bg-card p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Session</h2>
          {statusData.status === "qr_ready" || statusData.status === "disconnected" || statusData.status === "stopped" || statusData.status === "failed" ? <RefreshQrButton /> : null}
        </div>
        <p className="font-mono text-xs text-muted-foreground">{session?.sessionName}</p>
        <p>Last connected: {session?.lastConnectedAt ? formatDateTime(session.lastConnectedAt) : "never"}</p>
        {statusData.error || session?.lastError ? <p className="text-destructive">Last error: {statusData.error ?? session?.lastError}</p> : null}
      </section>

      <section className="rounded-xl border bg-card">
        <h2 className="border-b p-4 font-semibold">Recent messages</h2>
        <div className="divide-y">
          {history.map((m) => (
            <div key={m.id} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{m.phone} <span className="text-xs text-muted-foreground">· {m.messageType.replace(/_/g, " ").toLowerCase()}</span></p>
                {m.documentName ? <p className="text-xs text-muted-foreground">{m.documentName}</p> : null}
                {m.errorMessage ? <p className="text-xs text-destructive">{m.errorMessage}</p> : null}
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>{m.status}</p>
                <p>{formatDateTime(m.sentAt)}</p>
              </div>
            </div>
          ))}
          {history.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No messages sent yet.</p> : null}
        </div>
      </section>
    </div>
  );
}
