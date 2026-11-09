import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requirePortalCustomer } from "@/lib/portal-session";
import { formatCurrency } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";

export const metadata = { title: "Order tracking" };
export const dynamic = "force-dynamic";

export default async function PortalOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePortalCustomer();
  const { id } = await params;

  // Ownership is part of the query: someone else's order id is simply "not found".
  const order = await prisma.order.findFirst({
    where: { id, customerId: me.customerId, firmId: me.firmId },
    select: {
      id: true, orderNumber: true, status: true, placedAt: true, expectedDeliveryAt: true, deliveredAt: true,
      totalAmount: true, paidAmount: true, outstandingAmount: true,
      statusHistory: { orderBy: { createdAt: "asc" }, select: { toStatus: true, createdAt: true } },
      garments: { select: { status: true } },
      invoices: { select: { id: true, invoiceNumber: true, totalAmount: true, amountPaid: true, amountDue: true } },
    },
  });
  if (!order) notFound();

  const [pickups, deliveries] = await Promise.all([
    prisma.pickup.findMany({ where: { orderId: order.id, firmId: me.firmId }, select: { pickupNumber: true, status: true, scheduledAt: true }, orderBy: { scheduledAt: "asc" } }),
    prisma.delivery.findMany({ where: { orderId: order.id, firmId: me.firmId }, select: { deliveryNumber: true, status: true, scheduledAt: true }, orderBy: { scheduledAt: "asc" } }),
  ]);

  const qc = {
    passed: order.garments.filter((g) => g.status === "QC_PASSED").length,
    pending: order.garments.filter((g) => g.status === "QC_PENDING").length,
    rework: order.garments.filter((g) => ["QC_FAILED", "REWORK"].includes(g.status)).length,
  };

  return (
    <div className="space-y-5">
      <div>
        <Link href="/portal" className="text-xs text-muted-foreground underline">← My orders</Link>
        <h1 className="mt-1 text-lg font-bold">{order.orderNumber}</h1>
        <p className="text-sm">{order.status.replace(/_/g, " ")} · Expected {formatDate(order.expectedDeliveryAt)}</p>
      </div>

      <section className="space-y-2 rounded-xl border bg-card p-4 text-sm">
        <h2 className="font-semibold">Progress</h2>
        {order.statusHistory.map((h, i) => (
          <p key={i} className="flex justify-between gap-2">
            <span>{h.toStatus.replace(/_/g, " ")}</span>
            <span className="text-xs text-muted-foreground">{formatDateTime(h.createdAt)}</span>
          </p>
        ))}
      </section>

      <section className="space-y-1 rounded-xl border bg-card p-4 text-sm">
        <h2 className="font-semibold">Pickup, delivery &amp; quality check</h2>
        {pickups.map((p) => <p key={p.pickupNumber}>Pickup {p.pickupNumber}: {p.status.replace(/_/g, " ")}</p>)}
        {deliveries.map((d) => <p key={d.deliveryNumber}>Delivery {d.deliveryNumber}: {d.status.replace(/_/g, " ")}</p>)}
        {pickups.length + deliveries.length === 0 ? <p className="text-muted-foreground">No pickup or delivery booked.</p> : null}
        <p>Quality check: {qc.passed} passed{qc.pending ? `, ${qc.pending} pending` : ""}{qc.rework ? `, ${qc.rework} in rework` : ""}</p>
      </section>

      <section className="space-y-1 rounded-xl border bg-card p-4 text-sm">
        <h2 className="font-semibold">Invoice &amp; payment</h2>
        <p className="flex justify-between"><span>Total</span><span>{formatCurrency(order.totalAmount)}</span></p>
        <p className="flex justify-between"><span>Paid</span><span>{formatCurrency(order.paidAmount)}</span></p>
        <p className="flex justify-between font-semibold"><span>Balance</span><span>{formatCurrency(order.outstandingAmount)}</span></p>
        {order.invoices.map((inv) => (
          <p key={inv.id}>
            <a className="text-primary underline" href={`/portal/invoice/${inv.id}`}>Download invoice {inv.invoiceNumber}</a>
          </p>
        ))}
      </section>
    </div>
  );
}
