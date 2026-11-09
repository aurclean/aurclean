import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { requirePortalCustomer } from "@/lib/portal-session";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "My orders" };
export const dynamic = "force-dynamic";

export default async function PortalOrdersPage() {
  const me = await requirePortalCustomer();
  const orders = await prisma.order.findMany({
    where: { customerId: me.customerId, firmId: me.firmId },
    orderBy: { placedAt: "desc" },
    take: 50,
    select: { id: true, orderNumber: true, status: true, placedAt: true, expectedDeliveryAt: true, totalPieces: true },
  });

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">My orders</h1>
      {orders.length === 0 ? <p className="text-sm text-muted-foreground">You have no orders yet.</p> : null}
      {orders.map((o) => (
        <Link key={o.id} href={`/portal/orders/${o.id}`} className="block rounded-xl border bg-card p-4">
          <div className="flex justify-between gap-2">
            <p className="font-semibold">{o.orderNumber}</p>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{o.status.replace(/_/g, " ")}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Placed {formatDate(o.placedAt)} · {o.totalPieces} pcs · Expected {formatDate(o.expectedDeliveryAt)}
          </p>
        </Link>
      ))}
    </div>
  );
}
