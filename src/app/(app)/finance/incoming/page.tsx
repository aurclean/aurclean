import { PageHeader } from "@/components/shared/page-header";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { listLedgerEntries, listBankAccounts } from "@/lib/services/accounting";
import { IncomingView } from "./incoming-view";

export const metadata = { title: "Incoming Money" };

export default async function IncomingPage() {
  const user = await requirePermission(PERMISSIONS.FINANCE_VIEW);

  const branchId = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES)
    ? undefined
    : user.branchId ?? undefined;
  const firmId = requireFirmId(user);

  const [ledger, bankAccounts] = await Promise.all([
    listLedgerEntries({ firmId, branchId, limit: 300 }),
    listBankAccounts(firmId, branchId),
  ]);

  const canManage = hasPermission(user, PERMISSIONS.BILLING_RECORD_PAYMENT);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Incoming Money & Receipts"
        description="Dedicated module for customer order payments, advance receipts, and incoming cash flow."
      />
      <IncomingView
        rows={ledger.rows}
        bankAccounts={bankAccounts}
        canManage={canManage}
      />
    </div>
  );
}
