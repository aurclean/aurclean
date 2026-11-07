import { PageHeader } from "@/components/shared/page-header";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { getPnLReport, getFinancialOverview } from "@/lib/services/accounting";
import { FinancialReportsView } from "./financial-reports-view";

export const metadata = { title: "Financial Reports" };

export default async function FinancialReportsPage() {
  const user = await requirePermission(PERMISSIONS.REPORT_VIEW);

  const branchId = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES)
    ? undefined
    : user.branchId ?? undefined;
  const firmId = requireFirmId(user);

  const [pnl, metrics] = await Promise.all([
    getPnLReport({ firmId, branchId }),
    getFinancialOverview(firmId, branchId),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Financial Statements & P&L Reports"
        description="Comprehensive real-time Profit & Loss statement, cash flow statements, and balance sheet summary."
      />
      <FinancialReportsView pnl={pnl} metrics={metrics} />
    </div>
  );
}
