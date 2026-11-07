import { PageHeader } from "@/components/shared/page-header";
import { PERMISSIONS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { num, round2 } from "@/lib/money";
import { PayablesView } from "./payables-view";

export const metadata = { title: "Supplier Payables" };

export default async function PayablesPage() {
  await requirePermission(PERMISSIONS.FINANCE_VIEW);

  const rawSuppliers = await prisma.supplier.findMany({
    where: { isActive: true },
    include: {
      purchaseInvoices: {
        select: { total: true, amountPaid: true },
      },
    },
    orderBy: { name: "asc" },
  });

  const suppliers = rawSuppliers.map((s) => {
    let totalPurchased = 0;
    let totalPaid = 0;

    for (const inv of s.purchaseInvoices) {
      totalPurchased = round2(totalPurchased + num(inv.total));
      totalPaid = round2(totalPaid + num(inv.amountPaid));
    }

    const outstandingPayable = round2(totalPurchased - totalPaid);

    return {
      id: s.id,
      code: s.code,
      name: s.name,
      phone: s.phone,
      totalInvoices: s.purchaseInvoices.length,
      totalPurchased,
      totalPaid,
      outstandingPayable,
    };
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Supplier Payables Ledger"
        description="Track all inventory & chemical supplier invoices, unpaid purchase balances, and supplier disbursement history."
      />
      <PayablesView suppliers={suppliers} />
    </div>
  );
}
