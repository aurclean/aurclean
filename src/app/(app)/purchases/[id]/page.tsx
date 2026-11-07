import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ReceiveGoodsDialog } from "@/app/(app)/purchases/purchase-dialogs";
import { prisma } from "@/lib/prisma";
import { formatCurrency, num } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { assertBranchAccess, assertFirmAccess, hasPermission, requirePermission } from "@/lib/session";

export const metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePermission(PERMISSIONS.PURCHASE_VIEW);

  const po = await prisma.purchaseOrder.findFirst({
    where: { OR: [{ id }, { poNumber: id }] },
    include: {
      supplier: true,
      branch: { select: { name: true } },
      createdBy: { select: { name: true } },
      items: { include: { item: { select: { name: true, sku: true, unit: true } } } },
      receipts: {
        orderBy: { receivedAt: "desc" },
        include: {
          receivedBy: { select: { name: true } },
          items: { include: { item: { select: { name: true, unit: true } } } },
        },
      },
      invoices: true,
    },
  });

  if (!po) notFound();
  assertBranchAccess(user, po.branchId);
  assertFirmAccess(user, po.firmId);

  const canManage = hasPermission(user, PERMISSIONS.PURCHASE_MANAGE);
  const open = !["RECEIVED", "CANCELLED", "CLOSED"].includes(po.status);

  return (
    <div className="space-y-5">
      <PageHeader
        title={po.poNumber}
        description={`${po.supplier.name} · raised ${formatDate(po.orderDate)}${po.createdBy ? ` by ${po.createdBy.name}` : ""}`}
        actions={
          <>
            <Button asChild variant="outline" size="icon" aria-label="Back to purchases">
              <Link href="/purchases">
                <ArrowLeft />
              </Link>
            </Button>
            {canManage && open ? (
              <ReceiveGoodsDialog
                poId={po.id}
                poNumber={po.poNumber}
                lines={po.items.map((item) => ({
                  poItemId: item.id,
                  itemName: `${item.item.sku} · ${item.item.name}`,
                  unit: item.item.unit,
                  ordered: num(item.quantity),
                  received: num(item.receivedQuantity),
                }))}
              />
            ) : null}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={po.status} dot />
          <span className="text-sm text-muted-foreground">{po.branch.name}</span>
          {po.expectedDate ? (
            <span className="text-sm text-muted-foreground">
              Expected {formatDate(po.expectedDate)}
            </span>
          ) : null}
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2.5 text-left">Item</th>
                    <th className="px-4 py-2.5 text-right">Ordered</th>
                    <th className="px-4 py-2.5 text-right">Received</th>
                    <th className="px-4 py-2.5 text-right">Rate</th>
                    <th className="px-4 py-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {po.items.map((item) => {
                    const outstanding = num(item.quantity) - num(item.receivedQuantity);
                    return (
                      <tr key={item.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-2.5">
                          <p className="font-medium">{item.item.name}</p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {item.item.sku}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-right numeric">
                          {num(item.quantity)} {item.item.unit}
                        </td>
                        <td className="px-4 py-2.5 text-right numeric">
                          <span className={outstanding > 0 ? "text-warning-foreground" : "text-success"}>
                            {num(item.receivedQuantity)} {item.item.unit}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right numeric">
                          {formatCurrency(item.unitPrice)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium numeric">
                          {formatCurrency(item.lineTotal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Goods receipts ({po.receipts.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {po.receipts.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nothing received against this order yet.
                </p>
              ) : (
                <ul className="space-y-3">
                  {po.receipts.map((receipt) => (
                    <li key={receipt.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-sm font-semibold">
                          {receipt.grnNumber}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(receipt.receivedAt)}
                          {receipt.receivedBy ? ` · ${receipt.receivedBy.name}` : ""}
                        </span>
                      </div>
                      <ul className="mt-2 space-y-0.5 text-sm text-muted-foreground">
                        {receipt.items.map((line) => (
                          <li key={line.id}>
                            {line.item.name} — {num(line.quantity)} {line.item.unit}
                          </li>
                        ))}
                      </ul>
                      {receipt.notes ? (
                        <p className="mt-1 text-xs text-muted-foreground">{receipt.notes}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Supplier</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <p className="font-medium">{po.supplier.name}</p>
              <p className="font-mono text-xs text-muted-foreground">{po.supplier.code}</p>
              {po.supplier.contactPerson ? <p>{po.supplier.contactPerson}</p> : null}
              {po.supplier.phone ? (
                <p className="font-mono text-muted-foreground">{po.supplier.phone}</p>
              ) : null}
              {po.supplier.email ? (
                <p className="text-muted-foreground">{po.supplier.email}</p>
              ) : null}
              {po.supplier.gstNumber ? (
                <p className="text-xs text-muted-foreground">
                  GSTIN <span className="font-mono">{po.supplier.gstNumber}</span>
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Totals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="numeric">{formatCurrency(po.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax</span>
                <span className="numeric">{formatCurrency(po.taxAmount)}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-semibold">
                <span>Total</span>
                <span className="numeric">{formatCurrency(po.total)}</span>
              </div>
              {po.invoices.length > 0 ? (
                <>
                  <Separator />
                  {po.invoices.map((invoice) => (
                    <div key={invoice.id} className="flex justify-between">
                      <span className="text-muted-foreground">
                        Invoice {invoice.invoiceNumber}
                      </span>
                      <StatusBadge status={invoice.status} />
                    </div>
                  ))}
                </>
              ) : null}
            </CardContent>
          </Card>

          {po.notes ? (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">{po.notes}</CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
