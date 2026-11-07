import Link from "next/link";
import { Building, FileText, ShoppingCart, Wallet } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type Column } from "@/components/shared/data-table";
import { RowActions } from "@/components/shared/row-actions";
import { archiveSupplierAction } from "@/app/(app)/purchases/actions";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  NewPurchaseOrderDialog,
  NewSupplierDialog,
  SupplierPaymentDialog,
} from "@/app/(app)/purchases/purchase-dialogs";
import { prisma } from "@/lib/prisma";
import { formatCurrency, num, round2 } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import {
  branchOptions,
  enumOptions,
  param,
  scopedBranchId,
  type SearchParams,
} from "@/lib/queries/filters";
import type { Prisma } from "@/generated/prisma/client";

export const metadata = { title: "Purchases" };

interface PORow {
  id: string;
  poNumber: string;
  supplierName: string;
  status: string;
  orderDate: Date;
  expectedDate: Date | null;
  total: number;
  branchName: string;
  progress: string;
}

interface SupplierRow {
  id: string;
  code: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  creditDays: number;
  isActive: boolean;
  outstanding: number;
  orderCount: number;
}

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requirePermission(PERMISSIONS.PURCHASE_VIEW);

  const branchId = scopedBranchId(user, params);
  const firmId = requireFirmId(user);
  const tab = param(params, "tab") ?? "orders";
  const search = param(params, "q");
  const status = param(params, "status");

  const poWhere: Prisma.PurchaseOrderWhereInput = {
    firmId,
    ...(branchId ? { branchId } : {}),
    ...(status && status !== "all" ? { status: status as never } : {}),
    ...(search
      ? {
          OR: [
            { poNumber: { contains: search, mode: "insensitive" } },
            { supplier: { name: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [
    purchaseOrders,
    suppliers,
    invoices,
    payments,
    items,
    branches,
    openPoValue,
    payableTotal,
  ] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: poWhere,
      orderBy: { orderDate: "desc" },
      take: 100,
      include: {
        supplier: { select: { name: true } },
        branch: { select: { name: true } },
        items: { select: { quantity: true, receivedQuantity: true } },
      },
    }),
    prisma.supplier.findMany({
      where: { firmId },
      orderBy: { name: "asc" },
      include: {
        purchaseInvoices: { select: { total: true, amountPaid: true, status: true } },
        _count: { select: { purchaseOrders: true } },
      },
    }),
    prisma.purchaseInvoice.findMany({
      where: {
        supplier: { firmId },
        status: { in: ["UNPAID", "PARTIALLY_PAID", "OVERDUE"] },
      },
      orderBy: { invoiceDate: "desc" },
      include: { supplier: { select: { id: true, name: true } } },
    }),
    prisma.supplierPayment.findMany({
      where: { supplier: { firmId } },
      orderBy: { paidAt: "desc" },
      take: 50,
      include: {
        supplier: { select: { name: true } },
        paidBy: { select: { name: true } },
      },
    }),
    prisma.inventoryItem.findMany({
      where: { firmId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, sku: true, unit: true, costPrice: true },
    }),
    branchOptions(user),
    prisma.purchaseOrder.aggregate({
      where: {
        firmId,
        ...(branchId ? { branchId } : {}),
        status: { in: ["SENT", "PARTIALLY_RECEIVED"] },
      },
      _sum: { total: true },
    }),
    prisma.purchaseInvoice.findMany({
      where: {
        supplier: { firmId },
        status: { in: ["UNPAID", "PARTIALLY_PAID", "OVERDUE"] },
      },
      select: { total: true, amountPaid: true },
    }),
  ]);

  const payable = round2(
    payableTotal.reduce(
      (sum, invoice) => sum + num(invoice.total) - num(invoice.amountPaid),
      0,
    ),
  );

  const poRows: PORow[] = purchaseOrders.map((po) => {
    const ordered = po.items.reduce((sum, item) => sum + num(item.quantity), 0);
    const received = po.items.reduce((sum, item) => sum + num(item.receivedQuantity), 0);
    return {
      id: po.id,
      poNumber: po.poNumber,
      supplierName: po.supplier.name,
      status: po.status,
      orderDate: po.orderDate,
      expectedDate: po.expectedDate,
      total: num(po.total),
      branchName: po.branch.name,
      progress: ordered > 0 ? `${Math.round((received / ordered) * 100)}%` : "—",
    };
  });

  const supplierRows: SupplierRow[] = suppliers.map((supplier) => ({
    id: supplier.id,
    code: supplier.code,
    name: supplier.name,
    contactPerson: supplier.contactPerson,
    phone: supplier.phone,
    creditDays: supplier.creditDays,
    isActive: supplier.isActive,
    outstanding: round2(
      supplier.purchaseInvoices.reduce(
        (sum, invoice) => sum + num(invoice.total) - num(invoice.amountPaid),
        0,
      ),
    ),
    orderCount: supplier._count.purchaseOrders,
  }));

  const canManage = hasPermission(user, PERMISSIONS.PURCHASE_MANAGE);
  const canPay = hasPermission(user, PERMISSIONS.PURCHASE_PAY);

  const poColumns: Column<PORow>[] = [
    {
      key: "number",
      header: "PO",
      cell: (row) => (
        <Link
          href={`/purchases/${row.id}`}
          className="font-mono text-sm font-semibold text-primary hover:underline"
        >
          {row.poNumber}
        </Link>
      ),
    },
    { key: "supplier", header: "Supplier", cell: (row) => <span className="text-sm">{row.supplierName}</span> },
    ...(branches.length > 1
      ? [
          {
            key: "branch",
            header: "Branch",
            hideOnMobile: true,
            cell: (row: PORow) => (
              <span className="text-sm text-muted-foreground">{row.branchName}</span>
            ),
          } satisfies Column<PORow>,
        ]
      : []),
    { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} dot /> },
    {
      key: "received",
      header: "Received",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => <span className="text-sm numeric">{row.progress}</span>,
    },
    {
      key: "date",
      header: "Ordered",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.orderDate)}</span>
      ),
    },
    {
      key: "total",
      header: "Total",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <span className="text-sm font-medium numeric">{formatCurrency(row.total)}</span>
      ),
    },
  ];

  const supplierColumns: Column<SupplierRow>[] = [
    {
      key: "supplier",
      header: "Supplier",
      cell: (row) => (
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{row.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{row.code}</p>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-sm text-muted-foreground">
          <p>{row.contactPerson ?? "—"}</p>
          {row.phone ? <p className="font-mono text-xs">{row.phone}</p> : null}
        </div>
      ),
    },
    {
      key: "terms",
      header: "Credit",
      hideOnMobile: true,
      cell: (row) => <span className="text-sm">{row.creditDays} days</span>,
    },
    {
      key: "orders",
      header: "POs",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => <span className="text-sm numeric">{row.orderCount}</span>,
    },
    {
      key: "outstanding",
      header: "Outstanding",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <span
          className={`text-sm numeric ${row.outstanding > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}`}
        >
          {formatCurrency(row.outstanding)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.isActive ? "ACTIVE" : "INACTIVE"} />,
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (row) => (
        <RowActions
          viewHref={`/purchases/suppliers/${row.id}`}
          extra={[
            { label: "Raise a purchase order", icon: "plus", href: "/purchases?tab=orders" },
          ]}
          remove={
            canManage
              ? {
                  subject: row.name,
                  confirmLabel: row.orderCount > 0 ? "Retire supplier" : "Delete supplier",
                  successMessage:
                    row.orderCount > 0 ? `${row.name} retired` : `${row.name} deleted`,
                  impact:
                    row.orderCount > 0 ? (
                      <>
                        <p>
                          {row.name} has {row.orderCount} purchase order
                          {row.orderCount === 1 ? "" : "s"}, so the record is kept and
                          taken out of the pickers instead.
                        </p>
                        <p>Every order, invoice and payment stays readable.</p>
                      </>
                    ) : (
                      <p>
                        Nothing has ever been ordered from this supplier, so the record is
                        removed outright.
                      </p>
                    ),
                  action: archiveSupplierAction.bind(null, { id: row.id }),
                }
              : undefined
          }
        />
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Purchases & suppliers"
        description="Purchase orders, goods receipts, supplier invoices and payments."
        actions={
          <>
            {canPay && suppliers.length > 0 ? (
              <SupplierPaymentDialog
                suppliers={suppliers.map((supplier) => ({
                  id: supplier.id,
                  name: supplier.name,
                }))}
                invoices={invoices.map((invoice) => ({
                  id: invoice.id,
                  supplierId: invoice.supplier.id,
                  due: round2(num(invoice.total) - num(invoice.amountPaid)),
                  label: `${invoice.invoiceNumber} · ${formatCurrency(
                    round2(num(invoice.total) - num(invoice.amountPaid)),
                  )} due`,
                }))}
              />
            ) : null}
            {canManage ? <NewSupplierDialog /> : null}
            {canManage && suppliers.length > 0 && items.length > 0 ? (
              <NewPurchaseOrderDialog
                suppliers={suppliers.map((supplier) => ({
                  id: supplier.id,
                  name: supplier.name,
                  code: supplier.code,
                }))}
                items={items.map((item) => ({
                  ...item,
                  costPrice: num(item.costPrice),
                }))}
                branches={branches}
                defaultBranchId={user.branchId}
              />
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Suppliers" value={suppliers.length} icon={Building} />
        <StatCard
          label="Open purchase orders"
          value={formatCurrency(openPoValue._sum.total ?? 0)}
          icon={ShoppingCart}
          tone="info"
        />
        <StatCard
          label="Payable"
          value={formatCurrency(payable)}
          icon={Wallet}
          tone={payable > 0 ? "warning" : "default"}
        />
        <StatCard label="Open invoices" value={invoices.length} icon={FileText} />
      </div>

      <Tabs value={tab}>
        <TabsList>
          <TabsTrigger value="orders" asChild>
            <Link href="/purchases?tab=orders">Purchase orders</Link>
          </TabsTrigger>
          <TabsTrigger value="suppliers" asChild>
            <Link href="/purchases?tab=suppliers">Suppliers</Link>
          </TabsTrigger>
          <TabsTrigger value="payables" asChild>
            <Link href="/purchases?tab=payables">Payables</Link>
          </TabsTrigger>
          <TabsTrigger value="payments" asChild>
            <Link href="/purchases?tab=payments">Payments</Link>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="space-y-4">
          <FilterBar
            searchPlaceholder="PO number or supplier…"
            filters={[
              {
                name: "status",
                label: "Status",
                options: enumOptions([
                  "DRAFT",
                  "SENT",
                  "PARTIALLY_RECEIVED",
                  "RECEIVED",
                  "CANCELLED",
                  "CLOSED",
                ] as const),
              },
              ...(branches.length > 1
                ? [{ name: "branch", label: "Branch", options: branches }]
                : []),
            ]}
          />
          <DataTable
            columns={poColumns}
            rows={poRows}
            getRowKey={(row) => row.id}
            empty={
              <EmptyState
                icon={ShoppingCart}
                title="No purchase orders"
                description="Raise a purchase order to restock detergents, packaging and consumables."
              />
            }
          />
        </TabsContent>

        <TabsContent value="suppliers">
          <DataTable
            columns={supplierColumns}
            rows={supplierRows}
            getRowKey={(row) => row.id}
            empty={
              <EmptyState
                icon={Building}
                title="No suppliers yet"
                description="Add the vendors you buy consumables from."
              />
            }
          />
        </TabsContent>

        <TabsContent value="payables">
          {invoices.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Nothing payable"
              description="All supplier invoices are settled."
            />
          ) : (
            <ul className="space-y-2">
              {invoices.map((invoice) => {
                const due = round2(num(invoice.total) - num(invoice.amountPaid));
                return (
                  <li
                    key={invoice.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{invoice.supplier.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {invoice.invoiceNumber} · {formatDate(invoice.invoiceDate)}
                        {invoice.dueDate ? ` · due ${formatDate(invoice.dueDate)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={invoice.status} />
                      <span className="text-sm font-semibold numeric text-destructive">
                        {formatCurrency(due)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="payments">
          {payments.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No supplier payments"
              description="Payments you make to suppliers appear here."
            />
          ) : (
            <ul className="space-y-2">
              {payments.map((payment) => (
                <li
                  key={payment.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{payment.supplier.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {payment.paymentNumber} · {formatDate(payment.paidAt)}
                      {payment.reference ? ` · ${payment.reference}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={payment.method} tone="info" />
                    <span className="text-sm font-semibold numeric">
                      {formatCurrency(payment.amount)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
