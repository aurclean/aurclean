import { PageHeader } from "@/components/shared/page-header";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { listLedgerEntries, listBankAccounts } from "@/lib/services/accounting";
import { OutgoingView } from "./outgoing-view";

export const metadata = { title: "Outgoing Money" };

export default async function OutgoingPage() {
  const user = await requirePermission(PERMISSIONS.FINANCE_VIEW);

  const branchId = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES)
    ? undefined
    : user.branchId ?? undefined;
  const firmId = requireFirmId(user);

  const [ledger, bankAccounts] = await Promise.all([
    listLedgerEntries({ firmId, branchId, limit: 300 }),
    listBankAccounts(firmId, branchId),
  ]);

  const canManage = hasPermission(user, PERMISSIONS.EXPENSE_MANAGE);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Outgoing Money & Expenses"
        description="Dedicated module for recording business expenses, supplier payments, salary disbursements and outgoing transactions."
      />
      <OutgoingView
        rows={ledger.rows}
        bankAccounts={bankAccounts}
        canManage={canManage}
      />
    </div>
  );
}
