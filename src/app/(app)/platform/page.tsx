import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PERMISSIONS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { describeCodeStatus, getFirmDirectory } from "@/lib/services/platform-firms";
import { getAllFirmsWhatsAppStatus } from "@/lib/services/whatsapp";
import { waLabel } from "@/lib/whatsapp-status";
import { ResetAdminAccessCodeButton } from "@/app/(app)/firms/firm-dialogs";

export const metadata = { title: "Platform dashboard" };
export const dynamic = "force-dynamic";

/**
 * All registered firms. Credentials appear only as STATUS (issued / revoked,
 * when, by whom) — access codes are stored as hashes and cannot be shown;
 * "Reissue code" issues a new one and displays it once. Individual staff
 * codes never appear here.
 */
export default async function PlatformDashboardPage() {
  await requirePermission(PERMISSIONS.PLATFORM_VIEW);
  const [directory, wa] = await Promise.all([getFirmDirectory(), getAllFirmsWhatsAppStatus()]);
  const waByFirm = new Map(wa.map((r) => [r.firm.id, r.whatsapp]));

  const active = directory.filter((f) => f.status === "ACTIVE").length;
  const stats = [
    { label: "Firms", value: directory.length },
    { label: "Active", value: active },
    { label: "Inactive / suspended", value: directory.length - active },
    { label: "WhatsApp connected", value: wa.filter((r) => r.whatsapp.connected).length },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Firms"
        description="Every registered firm. Open a firm to see its users, staff and WhatsApp."
        actions={<Button asChild><Link href="/firms/new">Create firm</Link></Button>}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="border-emerald-900/10">
            <CardContent className="pt-5">
              <p className="text-2xl font-bold text-emerald-900">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        {directory.map((firm) => {
          const w = waByFirm.get(firm.id);
          const label = waLabel(w?.status ?? "not_configured");
          return (
            <Card key={firm.id} className="border-emerald-900/15">
              <CardContent className="space-y-4 pt-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-emerald-950">{firm.name}</h2>
                    <p className="text-xs text-muted-foreground">
                      Firm ID <span className="font-mono">{firm.code}</span> · <span className="font-mono">{firm.id}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={firm.status} />
                    <Button asChild size="sm"><Link href={`/firms/${firm.id}`}>View firm</Link></Button>
                  </div>
                </div>

                <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-1.5 lg:col-span-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Firm Manager</p>
                    {firm.managers.length === 0 ? <p className="text-muted-foreground">None assigned</p> : null}
                    {firm.managers.map((m) => (
                      <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-900/10 bg-emerald-50/40 p-2.5">
                        <div className="min-w-0">
                          <p className="font-medium">{m.name} {m.status !== "ACTIVE" ? <span className="text-xs text-destructive">({m.status.toLowerCase()})</span> : null}</p>
                          <p className="text-xs text-muted-foreground">Access code: {describeCodeStatus(m.code)}</p>
                        </div>
                        <ResetAdminAccessCodeButton userId={m.id} />
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">People</p>
                    <p>{firm.totalUsers} total users</p>
                    <p className="text-muted-foreground">{firm.totalStaff} staff (Field Manager + QC)</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">WhatsApp</p>
                    <p className="inline-flex items-center gap-1.5"><span className={`size-2 rounded-full ${label.dot}`} />{label.label}</p>
                    {w?.connected && w.phoneNumber ? <p className="text-xs text-muted-foreground">{w.phoneNumber}</p> : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {directory.length === 0 ? <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">No firms yet. Create the first one.</p> : null}
      </div>
    </div>
  );
}
