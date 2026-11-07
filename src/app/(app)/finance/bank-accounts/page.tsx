import { PageHeader } from "@/components/shared/page-header";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { listBankAccounts } from "@/lib/services/accounting";
import { BankAccountsView } from "./bank-view";

export const metadata = { title: "Bank Accounts" };

export default async function BankAccountsPage() {
  const user = await requirePermission(PERMISSIONS.FINANCE_VIEW);

  const branchId = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES)
    ? undefined
    : user.branchId ?? undefined;
  const firmId = requireFirmId(user);

  const accounts = await listBankAccounts(firmId, branchId);

  const canManage = hasPermission(user, PERMISSIONS.BANK_MANAGE);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Business Bank Accounts"
        description="Manage company bank accounts, view real-time balances, masked account security and transaction histories."
      />
      <BankAccountsView accounts={accounts} canManage={canManage} />
    </div>
  );
}
