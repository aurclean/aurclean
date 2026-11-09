import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { getAllFirmsWhatsAppStatus } from "@/lib/services/whatsapp";
import { waLabel } from "@/lib/whatsapp-status";
import { EnterFirmButton } from "@/app/(app)/firms/enter-firm-button";

export const metadata = { title: "Platform dashboard" };
export const dynamic = "force-dynamic";

/**
 * Cross-firm overview. Every figure is a per-firm aggregate (groupBy firmId);
 * no firm's records are listed here, and nothing on this page is scoped to
 * "the current firm" because a platform admin has none until they enter one.
 */
export default async function PlatformDashboardPage() {
  await requirePermission(PERMISSIONS.PLATFORM_VIEW);

  const [firms, orderCounts, customerCounts, userCounts, wa] = await Promise.all([
    prisma.firm.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, code: true, status: true } }),
    prisma.order.groupBy({ by: ["firmId"], _count: { _all: true } }),
    prisma.customer.groupBy({ by: ["firmId"], _count: { _all: true } }),
    prisma.user.groupBy({ by: ["firmId"], where: { firmId: { not: null } }, _count: { _all: true } }),
    getAllFirmsWhatsAppStatus(),
  ]);

  const count = (rows: Array<{ firmId: string | null; _count: { _all: number } }>, id: string) =>
    rows.find((r) => r.firmId === id)?._count._all ?? 0;
  const waByFirm = new Map(wa.map((r) => [r.firm.id, r.whatsapp]));

  const byStatus = (status: string) => firms.filter((f) => f.status === status).length;
  const stats = [
    { label: "Firms", value: firms.length },
    { label: "Active", value: byStatus("ACTIVE") },
    { label: "Suspended / inactive", value: byStatus("SUSPENDED") + byStatus("INACTIVE") },
    { label: "WhatsApp connected", value: wa.filter((r) => r.whatsapp.connected).length },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Platform dashboard"
        description="All registered firms at a glance. Open a firm only when you need to work inside it."
        actions={
          <Button asChild>
            <Link href="/firms">Create / manage firms</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-6">
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Firms</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {firms.map((firm) => {
            const w = waByFirm.get(firm.id);
            const label = waLabel(w?.status ?? "not_configured");
            return (
              <div key={firm.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
                <div className="min-w-0">
                  <Link href={`/firms/${firm.id}`} className="font-medium hover:underline">
                    {firm.name}
                  </Link>
                  <p className="font-mono text-xs text-muted-foreground">{firm.code}</p>
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
                  <span>{count(orderCounts, firm.id)} orders</span>
                  <span>{count(customerCounts, firm.id)} customers</span>
                  <span>{count(userCounts, firm.id)} users</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`size-2 rounded-full ${label.dot}`} /> {label.label}
                    {w?.connected && w.phoneNumber ? ` · ${w.phoneNumber}` : ""}
                  </span>
                  <StatusBadge status={firm.status} />
                </div>
                <EnterFirmButton firmId={firm.id} firmName={firm.name} disabled={firm.status !== "ACTIVE"} />
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
