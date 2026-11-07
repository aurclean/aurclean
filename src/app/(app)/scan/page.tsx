import { PageHeader } from "@/components/shared/page-header";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { listScanHistory } from "@/lib/services/scanning";

import { ScanContainer } from "./scan-container";

export const metadata = { title: "Scan & Batch Scan" };

export default async function ScanPage() {
  const user = await requirePermission(PERMISSIONS.GARMENT_SCAN);

  const history = await listScanHistory({
    firmId: requireFirmId(user),
    branchIds: hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES)
      ? null
      : user.branchId
        ? [user.branchId]
        : [],
    limit: 40,
  });

  const canUpdateStatus = hasPermission(user, [
    PERMISSIONS.PROCESSING_SORTING,
    PERMISSIONS.PROCESSING_WASHING,
    PERMISSIONS.PROCESSING_DRYING,
    PERMISSIONS.PROCESSING_IRONING,
    PERMISSIONS.PROCESSING_QC,
    PERMISSIONS.PROCESSING_PACKING,
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Scan Station & Batch Scanner"
        description="Scan single garments or run high-speed batch verification for continuous processing, sorting, packing and delivery prep."
      />
      <ScanContainer
        history={history}
        canUpdateStatus={canUpdateStatus}
        canResolve={hasPermission(user, PERMISSIONS.TRACKING_RESOLVE)}
      />
    </div>
  );
}
