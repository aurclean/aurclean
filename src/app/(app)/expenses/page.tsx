import { PageHeader } from "@/components/shared/page-header";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { listExpenses, getMonthlyExpenseSummary } from "@/lib/services/expenses";
import { ExpensesView } from "./expenses-view";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage() {
  const user = await requirePermission(PERMISSIONS.EXPENSE_VIEW);

  const branchId = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES)
    ? undefined
    : user.branchId ?? undefined;
  const firmId = requireFirmId(user);

  const [expenses, summary] = await Promise.all([
    listExpenses({ firmId, branchId, limit: 150 }),
    getMonthlyExpenseSummary(firmId, branchId),
  ]);

  const canManage = hasPermission(user, PERMISSIONS.EXPENSE_MANAGE);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Expense Management"
        description="Track business expenses (rent, utilities, salaries, supplies) to calculate clear net financial figures."
      />
      <ExpensesView
        expenses={expenses}
        monthlyTotal={summary.currentMonthTotal}
        categoryTotals={summary.categoryTotals}
        canManage={canManage}
      />
    </div>
  );
}
