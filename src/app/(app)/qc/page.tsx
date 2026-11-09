import { PageHeader } from "@/components/shared/page-header";
import { PERMISSIONS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { getQcQueue } from "@/lib/services/qc";
import { QcCard } from "@/app/(app)/qc/qc-card";

export const metadata = { title: "QC queue" };
export const dynamic = "force-dynamic";

export default async function QcQueuePage() {
  const user = await requirePermission(PERMISSIONS.QC_VIEW);
  const queue = await getQcQueue(user);
  return (
    <div className="space-y-4">
      <PageHeader title="QC queue" description={`${queue.length} garment${queue.length === 1 ? "" : "s"} waiting for inspection`} />
      {queue.length === 0 ? <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Nothing to inspect right now.</p> : null}
      <div className="space-y-3">
        {queue.map((g) => (
          <QcCard
            key={g.id}
            mode="inspect"
            garment={{
              id: g.id, code: g.garmentCode, title: [g.color, g.brand, g.garmentType.name].filter(Boolean).join(" "),
              service: g.service.name, orderNumber: g.order.orderNumber, status: g.status, reworkCount: g.reworkCount, lastNote: null,
            }}
          />
        ))}
      </div>
    </div>
  );
}
