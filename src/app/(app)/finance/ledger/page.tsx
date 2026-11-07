import { PageHeader } from "@/components/shared/page-header";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { listLedgerEntries } from "@/lib/services/accounting";
import { LedgerView } from "./ledger-view";

export const metadata = { title: "Business Ledger" };

export default async function LedgerPage() {
  const user = await requirePermission(PERMISSIONS.FINANCE_VIEW);

  const branchId = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES)
    ? undefined
    : user.branchId ?? undefined;
  const firmId = requireFirmId(user);

  const data = await listLedgerEntries({ firmId, branchId, limit: 300 });

  const canManage = hasPermission(user, PERMISSIONS.FINANCE_MANAGE);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Central Business Ledger"
        description="Immutable financial transaction journal recording debits, credits, running account balances and audit histories."
      />
      <LedgerView
        rows={data.rows}
        openingBalance={data.openingBalance}
        totalDebit={data.totalDebit}
        totalCredit={data.totalCredit}
        closingBalance={data.closingBalance}
        canManage={canManage}
      />
    </div>
  );
}
