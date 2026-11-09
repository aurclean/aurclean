import { prisma } from "@/lib/prisma";
import { requirePortalCustomer } from "@/lib/portal-session";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

export default async function PortalPaymentsPage() {
  const me = await requirePortalCustomer();
  const [payments, invoices] = await Promise.all([
    prisma.payment.findMany({
      where: { firmId: me.firmId, order: { customerId: me.customerId, firmId: me.firmId } },
      orderBy: { paidAt: "desc" },
      take: 50,
      select: { id: true, paymentNumber: true, amount: true, method: true, paidAt: true, order: { select: { orderNumber: true } } },
    }),
    prisma.invoice.findMany({
      where: { firmId: me.firmId, customerId: me.customerId, amountDue: { gt: 0 } },
      select: { id: true, invoiceNumber: true, amountDue: true },
    }),
  ]);
  const due = invoices.reduce((sum, i) => sum + Number(i.amountDue), 0);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Payments</h1>
      <p className="rounded-xl border bg-card p-4 text-sm">Outstanding: <strong>{formatCurrency(due)}</strong></p>
      {payments.map((p) => (
        <div key={p.id} className="flex justify-between gap-2 rounded-xl border bg-card p-4 text-sm">
          <div>
            <p className="font-medium">{p.paymentNumber}</p>
            <p className="text-xs text-muted-foreground">Order {p.order?.orderNumber} · {p.method} · {formatDate(p.paidAt)}</p>
          </div>
          <p className="font-semibold">{formatCurrency(p.amount)}</p>
        </div>
      ))}
      {payments.length === 0 ? <p className="text-sm text-muted-foreground">No payments recorded.</p> : null}
    </div>
  );
}
