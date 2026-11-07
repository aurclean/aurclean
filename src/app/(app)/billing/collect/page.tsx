import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { CollectForm } from "@/app/(app)/billing/collect/collect-form";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/money";
import { PERMISSIONS } from "@/lib/rbac";
import { assertBranchAccess, requirePermission } from "@/lib/session";
import { param, type SearchParams } from "@/lib/queries/filters";

export const metadata = { title: "Collect payment" };

export default async function CollectPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requirePermission(PERMISSIONS.BILLING_RECORD_PAYMENT);
  const orderId = param(params, "order");

  const order = orderId
    ? await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          branchId: true,
          orderNumber: true,
          customerName: true,
          totalAmount: true,
          paidAmount: true,
          outstandingAmount: true,
        },
      })
    : null;

  if (!order) {
    return (
      <div className="space-y-5">
        <PageHeader title="Collect payment" />
        <EmptyState
          title="Pick an order first"
          description="Open an order and use “Collect payment”, or search for the order number."
          action={
            <Button asChild size="sm">
              <Link href="/orders?payment=UNPAID">Orders with a balance</Link>
            </Button>
          }
        />
      </div>
    );
  }

  assertBranchAccess(user, order.branchId);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Collect payment"
        description={`Against ${order.orderNumber}`}
        actions={
          <Button asChild variant="outline">
            <Link href={`/orders/${order.id}`}>
              <ArrowLeft /> Back to order
            </Link>
          </Button>
        }
      />
      <CollectForm
        orderId={order.id}
        orderNumber={order.orderNumber}
        customerName={order.customerName}
        totalAmount={num(order.totalAmount)}
        paidAmount={num(order.paidAmount)}
        outstanding={num(order.outstandingAmount)}
      />
    </div>
  );
}
