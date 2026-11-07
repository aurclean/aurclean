import { PageHeader } from "@/components/shared/page-header";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/money";
import { ReceivablesView } from "./receivables-view";

export const metadata = { title: "Customer Receivables" };

export default async function ReceivablesPage() {
  const user = await requirePermission(PERMISSIONS.FINANCE_VIEW);

  const branchId = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES)
    ? undefined
    : user.branchId ?? undefined;
  const firmId = requireFirmId(user);

  const rawCustomers = await prisma.customer.findMany({
    where: {
      firmId,
      ...(branchId ? { branchId } : {}),
      outstandingAmount: { gt: 0 },
    },
    orderBy: { outstandingAmount: "desc" },
    select: {
      id: true,
      name: true,
      phone: true,
      orderCount: true,
      totalSpent: true,
      outstandingAmount: true,
    },
  });

  const customers = rawCustomers.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    orderCount: c.orderCount,
    totalSpent: num(c.totalSpent),
    outstandingAmount: num(c.outstandingAmount),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Customer Receivables Ledger"
        description="Track all unpaid customer accounts, outstanding order balances, and direct payment collection workflows."
      />
      <ReceivablesView customers={customers} />
    </div>
  );
}
