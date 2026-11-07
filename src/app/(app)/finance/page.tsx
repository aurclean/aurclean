import { PageHeader } from "@/components/shared/page-header";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { getFinancialOverview } from "@/lib/services/accounting";
import { FinanceOverviewView } from "./finance-overview";

export const metadata = { title: "Financial Overview" };

export default async function FinanceOverviewPage() {
  const user = await requirePermission(PERMISSIONS.FINANCE_VIEW);

  const branchId = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES)
    ? undefined
    : user.branchId ?? undefined;

  const metrics = await getFinancialOverview(requireFirmId(user), branchId);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Financial Overview & Executive Dashboard"
        description="Unified financial dashboard rolling up cash in hand, bank balances, customer receivables, supplier payables and real-time cash flow."
      />
      <FinanceOverviewView metrics={metrics} />
    </div>
  );
}
