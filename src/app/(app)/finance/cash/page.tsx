import { PageHeader } from "@/components/shared/page-header";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { getCashAccountSummary, listBankAccounts } from "@/lib/services/accounting";
import { CashView } from "./cash-view";

export const metadata = { title: "Cash in Hand" };

export default async function CashInHandPage() {
  const user = await requirePermission(PERMISSIONS.FINANCE_VIEW);

  const branchId = user.branchId ?? "main";
  const firmId = requireFirmId(user);

  const [summary, bankAccounts] = await Promise.all([
    getCashAccountSummary(branchId),
    listBankAccounts(firmId, branchId),
  ]);

  const canManage = hasPermission(user, PERMISSIONS.FINANCE_MANAGE);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cash in Hand & Counter Register"
        description="Physical cash drawer register, opening balance, cash received, cash paid out, and bank cash deposits/withdrawals."
      />
      <CashView
        summary={summary}
        bankAccounts={bankAccounts}
        canManage={canManage}
      />
    </div>
  );
}
