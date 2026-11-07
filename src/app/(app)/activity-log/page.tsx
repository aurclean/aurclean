import { PageHeader } from "@/components/shared/page-header";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { listAuditLogs } from "@/lib/services/audit-log";
import { ActivityLogView } from "./activity-log-view";

export const metadata = { title: "Activity Log" };

export default async function ActivityLogPage() {
  const user = await requirePermission(PERMISSIONS.AUDIT_VIEW);

  const branchId = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES)
    ? undefined
    : user.branchId ?? undefined;
  const firmId = requireFirmId(user);

  const logs = await listAuditLogs({ firmId, branchId, limit: 200 });

  return (
    <div className="space-y-5">
      <PageHeader
        title="System Activity & Audit Log"
        description="Comprehensive immutable operational activity log tracking created orders, status updates, scans, payments, printed tags and user access."
      />
      <ActivityLogView logs={logs} />
    </div>
  );
}
