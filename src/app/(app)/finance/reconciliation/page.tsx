import { PageHeader } from "@/components/shared/page-header";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import {
  listReconciliations,
  listBankAccounts,
  getCashAccountSummary,
} from "@/lib/services/accounting";
import { ReconciliationView } from "./reconciliation-view";

export const metadata = { title: "Reconciliation" };

export default async function ReconciliationPage() {
  const user = await requirePermission(PERMISSIONS.FINANCE_VIEW);

  const branchId = user.branchId ?? "main";
  const firmId = requireFirmId(user);

  const [reconciliations, bankAccounts, cash] = await Promise.all([
    listReconciliations(branchId),
    listBankAccounts(firmId, branchId),
    getCashAccountSummary(branchId),
  ]);

  const canManage = hasPermission(user, PERMISSIONS.RECONCILE_MANAGE);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cash & Bank Reconciliation Engine"
        description="Verify physical cash register counts and bank statements against ERP ledger balances with audit history."
      />
      <ReconciliationView
        reconciliations={reconciliations}
        bankAccounts={bankAccounts}
        cashCurrentBalance={cash.currentBalance}
        canManage={canManage}
      />
    </div>
  );
}
