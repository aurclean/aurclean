import { PageHeader } from "@/components/shared/page-header";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/money";
import { SalesView } from "./sales-view";

export const metadata = { title: "Sales Journal" };

export default async function SalesPage() {
  const user = await requirePermission(PERMISSIONS.FINANCE_VIEW);

  const branchId = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES)
    ? undefined
    : user.branchId ?? undefined;
  const firmId = requireFirmId(user);

  const rawOrders = await prisma.order.findMany({
    where: {
      firmId,
      ...(branchId ? { branchId } : {}),
      status: { notIn: ["CANCELLED"] },
    },
    include: {
      items: { select: { quantity: true } },
    },
    orderBy: { placedAt: "desc" },
    take: 200,
  });

  const sales = rawOrders.map((o) => {
    const itemCount = o.items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = num(o.subtotal);
    const discount = num(o.discountAmount);
    const totalAmount = num(o.totalAmount);
    const paidAmount = num(o.paidAmount);
    const outstandingAmount = num(o.outstandingAmount);
    const salesReference = `SAL-${o.orderNumber.replace(/[^0-9]/g, "") || o.orderNumber}`;

    return {
      id: o.id,
      orderNumber: o.orderNumber,
      salesReference,
      customerName: o.customerName,
      placedAt: o.placedAt.toISOString(),
      itemCount,
      subtotal,
      discount,
      totalAmount,
      paidAmount,
      outstandingAmount,
      paymentStatus: o.paymentStatus,
    };
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sales Register & Sales Journal"
        description="Completed & billed laundry order sales linked directly to customer sales records."
      />
      <SalesView sales={sales} />
    </div>
  );
}
