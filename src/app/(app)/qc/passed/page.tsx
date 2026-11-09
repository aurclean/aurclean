import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { getQcHistory } from "@/lib/services/qc";

export const metadata = { title: "QC passed" };
export const dynamic = "force-dynamic";

export default async function QcPassedPage() {
  const user = await requirePermission(PERMISSIONS.QC_VIEW);
  const rows = await getQcHistory(user, "PASSED");
  return (
    <div className="space-y-4">
      <PageHeader title="Passed" description="Recently passed garments" />
      <Card>
        <CardContent className="divide-y p-0">
          {rows.map((r) => (
            <div key={r.id} className="flex justify-between gap-3 p-4 text-sm">
              <div>
                <p className="font-mono font-medium">{r.garment.garmentCode}</p>
                <p className="text-xs text-muted-foreground">{r.garment.garmentType.name} · Order {r.order.orderNumber}</p>
                {r.notes ? <p className="text-xs">{r.notes}</p> : null}
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <p>{formatDateTime(r.createdAt)}</p>
                <p>{r.inspector?.name ?? "—"}</p>
              </div>
            </div>
          ))}
          {rows.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">Nothing passed yet.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
