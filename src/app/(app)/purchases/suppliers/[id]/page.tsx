import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mail, MapPin, Phone, Receipt, ShoppingCart, Wallet } from "lucide-react";

import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { formatCurrency, num } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { humanize } from "@/lib/utils";

export const metadata = { title: "Supplier" };

interface OrderRow {
  id: string;
  poNumber: string;
  status: string;
  total: number;
  orderedAt: Date;
  lines: number;
}

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePermission(PERMISSIONS.PURCHASE_VIEW);

  // `city` and `pincode` are not on Supplier; the address line carries them.
  const supplier = await prisma.supplier.findFirst({
    where: { firmId: requireFirmId(user), OR: [{ id }, { code: id }] },
    include: {
      purchaseOrders: {
        orderBy: { orderDate: "desc" },
        take: 25,
        include: { _count: { select: { items: true } } },
      },
      payments: {
        orderBy: { paidAt: "desc" },
        take: 12,
        include: { paidBy: { select: { name: true } } },
      },
      _count: { select: { purchaseOrders: true, payments: true } },
    },
  });

  if (!supplier) notFound();

  const ordered = supplier.purchaseOrders.reduce((sum, po) => sum + num(po.total), 0);
  const paid = supplier.payments.reduce((sum, payment) => sum + num(payment.amount), 0);

  const rows: OrderRow[] = supplier.purchaseOrders.map((po) => ({
    id: po.id,
    poNumber: po.poNumber,
    status: po.status,
    total: num(po.total),
    orderedAt: po.orderDate,
    lines: po._count.items,
  }));

  const columns: Column<OrderRow>[] = [
    {
      key: "po",
      header: "Purchase order",
      cell: (row) => (
        <Link
          href={`/purchases/${row.id}`}
          className="font-mono text-sm font-medium text-primary hover:underline"
        >
          {row.poNumber}
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} label={humanize(row.status)} />,
    },
    {
      key: "lines",
      header: "Lines",
      className: "text-right",
      headerClassName: "text-right",
      hideOnMobile: true,
      toggleLabel: "Lines",
      cell: (row) => <span className="text-sm numeric">{row.lines}</span>,
    },
    {
      key: "total",
      header: "Total",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => <span className="text-sm numeric">{formatCurrency(row.total)}</span>,
    },
    {
      key: "ordered",
      header: "Ordered",
      hideOnMobile: true,
      toggleLabel: "Ordered",
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.orderedAt)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={supplier.name}
        description={`${supplier.code}${supplier.contactPerson ? ` · ${supplier.contactPerson}` : ""}`}
        actions={
          <>
            <Button asChild variant="outline" size="icon" aria-label="Back to purchases">
              <Link href="/purchases">
                <ArrowLeft />
              </Link>
            </Button>
            {hasPermission(user, PERMISSIONS.PURCHASE_MANAGE) ? (
              <Button asChild variant="outline">
                <Link href={`/purchases?edit=${supplier.id}`}>Edit supplier</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        {supplier.isActive ? (
          <Badge tone="success">Active</Badge>
        ) : (
          <Badge tone="neutral">Retired</Badge>
        )}
        {supplier.paymentTerms ? (
          <Badge tone="outline">{supplier.paymentTerms}</Badge>
        ) : null}
        {supplier.gstNumber ? <Badge tone="outline">GSTIN {supplier.gstNumber}</Badge> : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Purchase orders"
          value={supplier._count.purchaseOrders}
          icon={ShoppingCart}
        />
        <StatCard
          label="Ordered (recent)"
          value={formatCurrency(ordered)}
          icon={Receipt}
          animate={false}
        />
        <StatCard
          label="Paid (recent)"
          value={formatCurrency(paid)}
          icon={Wallet}
          tone="success"
          animate={false}
        />
        <StatCard
          label="Still owed"
          value={formatCurrency(Math.max(0, ordered - paid))}
          tone={ordered - paid > 0 ? "warning" : "default"}
          animate={false}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {supplier.phone ? (
                <p className="flex items-center gap-2">
                  <Phone className="size-4 text-muted-foreground" />
                  <span className="font-mono">{supplier.phone}</span>
                </p>
              ) : null}
              {supplier.email ? (
                <p className="flex items-center gap-2">
                  <Mail className="size-4 text-muted-foreground" />
                  <span className="break-all">{supplier.email}</span>
                </p>
              ) : null}
              {supplier.addressLine ? (
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>
                    {supplier.addressLine}
                  </span>
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {supplier.creditDays > 0
                  ? `${supplier.creditDays} days credit`
                  : "Paid on delivery"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent payments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {supplier.payments.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Nothing paid yet.
                </p>
              ) : (
                supplier.payments.map((payment) => (
                  <div
                    key={payment.id}
                    className="flex items-baseline justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="font-mono">{payment.paymentNumber}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDateTime(payment.paidAt)}
                        {payment.paidBy ? ` · ${payment.paidBy.name}` : ""}
                      </span>
                    </span>
                    <span className="numeric font-medium">
                      {formatCurrency(payment.amount)}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Purchase orders</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              columns={columns}
              rows={rows}
              getRowKey={(row) => row.id}
              className="rounded-none border-0"
              empty={
                <EmptyState
                  icon={ShoppingCart}
                  title="No purchase orders"
                  description="Raise one from the purchases screen to start a history with this supplier."
                />
              }
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
