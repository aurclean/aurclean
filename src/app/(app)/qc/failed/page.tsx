import { PageHeader } from "@/components/shared/page-header";
import { PERMISSIONS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { getFailedOrRework } from "@/lib/services/qc";
import { QcCard } from "@/app/(app)/qc/qc-card";

export const metadata = { title: "Failed / rework" };
export const dynamic = "force-dynamic";

export default async function QcFailedPage() {
  const user = await requirePermission(PERMISSIONS.QC_VIEW);
  const rows = await getFailedOrRework(user);
  return (
    <div className="space-y-4">
      <PageHeader title="Failed / rework" description="Garments that failed inspection or are being reworked" />
      {rows.length === 0 ? <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">No failed garments.</p> : null}
      <div className="space-y-3">
        {rows.map((g) => (
          <QcCard
            key={g.id}
            mode="rework"
            garment={{
              id: g.id, code: g.garmentCode, title: [g.color, g.brand, g.garmentType.name].filter(Boolean).join(" "),
              service: g.service.name, orderNumber: g.order.orderNumber, status: g.status, reworkCount: g.reworkCount,
              lastNote: g.qcRecords[0]?.notes ?? null,
            }}
          />
        ))}
      </div>
    </div>
  );
}
