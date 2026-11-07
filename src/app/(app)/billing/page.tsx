import Link from "next/link";
import { Banknote, Receipt, TrendingUp, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type Column } from "@/components/shared/data-table";
import { RowActions } from "@/components/shared/row-actions";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { ReminderButton } from "@/app/(app)/billing/reminder-button";
import { prisma } from "@/lib/prisma";
import { formatCurrency, num } from "@/lib/money";
import { formatDate, formatDateTime, todayRange } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import {
  PAGE_SIZE,
  branchOptions,
  dateRangeFrom,
  enumOptions,
  pageParam,
  param,
  scopedBranchId,
  type SearchParams,
} from "@/lib/queries/filters";
import type { Prisma } from "@/generated/prisma/client";

export const metadata = { title: "Billing" };

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  billToName: string;
  orderId: string | null;
  orderNumber: string | null;
  status: string;
  totalAmount: number;
  amountDue: number;
  issuedAt: Date;
}

interface PaymentRow {
  id: string;
  paymentNumber: string;
  orderId: string | null;
  orderNumber: string | null;
  amount: number;
  method: string;
  paidAt: Date;
  receivedBy: string | null;
}

interface OutstandingRow {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  outstandingAmount: number;
  expectedDeliveryAt: Date;
  status: string;
  overdue: boolean;
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requirePermission(PERMISSIONS.BILLING_VIEW);

  const page = pageParam(params);
  const branchId = scopedBranchId(user, params);
  const firmId = requireFirmId(user);
  const range = dateRangeFrom(params);
  const search = param(params, "q");
  const status = param(params, "status");
  const method = param(params, "method");
  const tab = param(params, "tab") ?? "invoices";
  const today = todayRange();

  const branchWhere = { firmId, ...(branchId ? { branchId } : {}) };

  const invoiceWhere: Prisma.InvoiceWhereInput = {
    ...branchWhere,
    ...(status && status !== "all" ? { status: status as never } : {}),
    ...(range ? { issuedAt: { gte: range.from, lte: range.to } } : {}),
    ...(search
      ? {
          OR: [
            { invoiceNumber: { contains: search, mode: "insensitive" } },
            { billToName: { contains: search, mode: "insensitive" } },
            { order: { orderNumber: { contains: search.toUpperCase() } } },
          ],
        }
      : {}),
  };

  const paymentWhere: Prisma.PaymentWhereInput = {
    ...branchWhere,
    state: "CAPTURED",
    ...(method && method !== "all" ? { method: method as never } : {}),
    ...(range ? { paidAt: { gte: range.from, lte: range.to } } : {}),
    ...(search
      ? {
          OR: [
            { paymentNumber: { contains: search, mode: "insensitive" } },
            { order: { orderNumber: { contains: search.toUpperCase() } } },
          ],
        }
      : {}),
  };

  const outstandingWhere: Prisma.OrderWhereInput = {
    ...branchWhere,
    outstandingAmount: { gt: 0 },
    status: { notIn: ["CANCELLED", "REFUNDED"] },
    ...(search
      ? {
          OR: [
            { orderNumber: { contains: search.toUpperCase() } },
            { customerName: { contains: search, mode: "insensitive" } },
            { customerPhone: { contains: search } },
          ],
        }
      : {}),
  };

  const [
    invoices,
    invoiceCount,
    payments,
    paymentCount,
    outstandingOrders,
    outstandingCount,
    todayCollected,
    totalOutstanding,
    refundTotal,
    branches,
  ] = await Promise.all([
    prisma.invoice.findMany({
      where: invoiceWhere,
      orderBy: { issuedAt: "desc" },
      skip: tab === "invoices" ? (page - 1) * PAGE_SIZE : 0,
      take: PAGE_SIZE,
      include: { order: { select: { id: true, orderNumber: true } } },
    }),
    prisma.invoice.count({ where: invoiceWhere }),
    prisma.payment.findMany({
      where: paymentWhere,
      orderBy: { paidAt: "desc" },
      skip: tab === "payments" ? (page - 1) * PAGE_SIZE : 0,
      take: PAGE_SIZE,
      include: {
        order: { select: { id: true, orderNumber: true } },
        receivedBy: { select: { name: true } },
      },
    }),
    prisma.payment.count({ where: paymentWhere }),
    prisma.order.findMany({
      where: outstandingWhere,
      orderBy: { expectedDeliveryAt: "asc" },
      skip: tab === "outstanding" ? (page - 1) * PAGE_SIZE : 0,
      take: PAGE_SIZE,
    }),
    prisma.order.count({ where: outstandingWhere }),
    prisma.payment.aggregate({
      where: { ...branchWhere, state: "CAPTURED", paidAt: { gte: today.from, lte: today.to } },
      _sum: { amount: true },
    }),
    prisma.order.aggregate({
      where: { ...branchWhere, status: { notIn: ["CANCELLED", "REFUNDED"] } },
      _sum: { outstandingAmount: true },
    }),
    prisma.refund.aggregate({
      where: {
        status: "PROCESSED",
        order: { firmId },
        ...(range ? { processedAt: { gte: range.from, lte: range.to } } : {}),
      },
      _sum: { amount: true },
    }),
    branchOptions(user),
  ]);

  const now = new Date();

  const invoiceRows: InvoiceRow[] = invoices.map((invoice) => ({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    billToName: invoice.billToName,
    orderId: invoice.order?.id ?? null,
    orderNumber: invoice.order?.orderNumber ?? null,
    status: invoice.status,
    totalAmount: num(invoice.totalAmount),
    amountDue: num(invoice.amountDue),
    issuedAt: invoice.issuedAt,
  }));

  const paymentRows: PaymentRow[] = payments.map((payment) => ({
    id: payment.id,
    paymentNumber: payment.paymentNumber,
    orderId: payment.order?.id ?? null,
    orderNumber: payment.order?.orderNumber ?? null,
    amount: num(payment.amount),
    method: payment.method,
    paidAt: payment.paidAt,
    receivedBy: payment.receivedBy?.name ?? null,
  }));

  const outstandingRows: OutstandingRow[] = outstandingOrders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    outstandingAmount: num(order.outstandingAmount),
    expectedDeliveryAt: order.expectedDeliveryAt,
    status: order.status,
    overdue: order.expectedDeliveryAt < now,
  }));

  const invoiceColumns: Column<InvoiceRow>[] = [
    {
      key: "number",
      header: "Invoice",
      cell: (row) => (
        <Link
          href={`/billing/invoices/${row.id}`}
          className="font-mono text-sm font-semibold text-primary hover:underline"
        >
          {row.invoiceNumber}
        </Link>
      ),
    },
    { key: "billTo", header: "Billed to", cell: (row) => <span className="text-sm">{row.billToName}</span> },
    {
      key: "order",
      header: "Order",
      hideOnMobile: true,
      cell: (row) =>
        row.orderId ? (
          <Link href={`/orders/${row.orderId}`} className="font-mono text-sm hover:underline">
            {row.orderNumber}
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">Consolidated</span>
        ),
    },
    { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: "issued",
      header: "Issued",
      hideOnMobile: true,
      cell: (row) => <span className="text-sm text-muted-foreground">{formatDate(row.issuedAt)}</span>,
    },
    {
      key: "total",
      header: "Total",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => <span className="text-sm font-medium numeric">{formatCurrency(row.totalAmount)}</span>,
    },
    {
      key: "due",
      header: "Due",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <span
          className={`text-sm numeric ${row.amountDue > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}`}
        >
          {formatCurrency(row.amountDue)}
        </span>
      ),
    },
  ];

  const paymentColumns: Column<PaymentRow>[] = [
    {
      key: "number",
      header: "Payment",
      cell: (row) => <span className="font-mono text-sm font-semibold">{row.paymentNumber}</span>,
    },
    {
      key: "order",
      header: "Order",
      cell: (row) =>
        row.orderId ? (
          <Link href={`/orders/${row.orderId}`} className="font-mono text-sm text-primary hover:underline">
            {row.orderNumber}
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    { key: "method", header: "Method", cell: (row) => <StatusBadge status={row.method} tone="info" /> },
    {
      key: "at",
      header: "Received",
      hideOnMobile: true,
      cell: (row) => <span className="text-sm text-muted-foreground">{formatDateTime(row.paidAt)}</span>,
    },
    {
      key: "by",
      header: "By",
      hideOnMobile: true,
      cell: (row) => <span className="text-sm text-muted-foreground">{row.receivedBy ?? "—"}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <span className="text-sm font-semibold numeric text-success">
          {formatCurrency(row.amount)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (row) => (
        <RowActions
          viewHref={`/billing/payments/${row.id}`}
          extra={
            row.orderId
              ? [
                  { label: "View order", icon: "list" as const, href: `/orders/${row.orderId}` },
                  {
                    label: "Print receipt",
                    icon: "printer" as const,
                    href: `/orders/${row.orderId}/receipt`,
                  },
                ]
              : []
          }
        />
      ),
    },
  ];

  const outstandingColumns: Column<OutstandingRow>[] = [
    {
      key: "order",
      header: "Order",
      cell: (row) => (
        <Link href={`/orders/${row.id}`} className="font-mono text-sm font-semibold text-primary hover:underline">
          {row.orderNumber}
        </Link>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{row.customerName}</p>
          <p className="font-mono text-xs text-muted-foreground">{row.customerPhone}</p>
        </div>
      ),
    },
    { key: "status", header: "Order status", cell: (row) => <StatusBadge status={row.status} dot /> },
    {
      key: "due",
      header: "Due date",
      cell: (row) => (
        <span className={`text-sm ${row.overdue ? "font-medium text-destructive" : ""}`}>
          {formatDate(row.expectedDeliveryAt)}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Outstanding",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm font-semibold numeric text-destructive">
            {formatCurrency(row.outstandingAmount)}
          </span>
          {hasPermission(user, PERMISSIONS.BILLING_RECORD_PAYMENT) ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/billing/collect?order=${row.id}`}>Collect</Link>
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const activeTotal =
    tab === "payments" ? paymentCount : tab === "outstanding" ? outstandingCount : invoiceCount;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Billing & payments"
        description="Invoices, collections and outstanding balances across the business."
        actions={
          hasPermission(user, PERMISSIONS.NOTIFICATION_MANAGE) ? <ReminderButton /> : null
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Collected today"
          value={formatCurrency(todayCollected._sum.amount ?? 0)}
          icon={Wallet}
          tone="success"
        />
        <StatCard
          label="Total outstanding"
          value={formatCurrency(totalOutstanding._sum.outstandingAmount ?? 0)}
          icon={Banknote}
          tone="danger"
          href="/billing?tab=outstanding"
        />
        <StatCard label="Invoices" value={invoiceCount} icon={Receipt} />
        <StatCard
          label="Refunds in range"
          value={formatCurrency(refundTotal._sum.amount ?? 0)}
          icon={TrendingUp}
          tone="warning"
        />
      </div>

      <Tabs value={tab}>
        <TabsList>
          <TabsTrigger value="invoices" asChild>
            <Link href="/billing?tab=invoices">Invoices</Link>
          </TabsTrigger>
          <TabsTrigger value="payments" asChild>
            <Link href="/billing?tab=payments">Payments</Link>
          </TabsTrigger>
          <TabsTrigger value="outstanding" asChild>
            <Link href="/billing?tab=outstanding">Outstanding</Link>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="space-y-4">
          <FilterBar
            searchPlaceholder="Invoice number, customer, order…"
            showDateRange
            filters={[
              {
                name: "status",
                label: "Status",
                options: enumOptions([
                  "DRAFT",
                  "ISSUED",
                  "PARTIALLY_PAID",
                  "PAID",
                  "OVERDUE",
                  "CANCELLED",
                ] as const),
              },
              ...(branches.length > 1
                ? [{ name: "branch", label: "Branch", options: branches }]
                : []),
            ]}
          />
          <DataTable
            columns={invoiceColumns}
            rows={invoiceRows}
            getRowKey={(row) => row.id}
            empty={
              <EmptyState
                icon={Receipt}
                title="No invoices"
                description="An invoice is raised automatically whenever an order is booked."
              />
            }
          />
        </TabsContent>

        <TabsContent value="payments" className="space-y-4">
          <FilterBar
            searchPlaceholder="Payment number or order…"
            showDateRange
            filters={[
              {
                name: "method",
                label: "Method",
                options: enumOptions([
                  "CASH",
                  "UPI",
                  "CARD",
                  "ONLINE",
                  "BANK_TRANSFER",
                  "CREDIT",
                  "OTHER",
                ] as const),
              },
              ...(branches.length > 1
                ? [{ name: "branch", label: "Branch", options: branches }]
                : []),
            ]}
          />
          <DataTable
            columns={paymentColumns}
            rows={paymentRows}
            getRowKey={(row) => row.id}
            empty={
              <EmptyState
                icon={Wallet}
                title="No payments recorded"
                description="Payments appear here as soon as money is collected at a counter or online."
              />
            }
          />
        </TabsContent>

        <TabsContent value="outstanding" className="space-y-4">
          <FilterBar searchPlaceholder="Order, customer or phone…" />
          <DataTable
            columns={outstandingColumns}
            rows={outstandingRows}
            getRowKey={(row) => row.id}
            rowClassName={(row) => (row.overdue ? "bg-destructive/4" : undefined)}
            empty={
              <EmptyState
                icon={Banknote}
                title="Everything is settled"
                description="No order currently carries an outstanding balance."
              />
            }
          />
        </TabsContent>
      </Tabs>

      <Pagination page={page} pageSize={PAGE_SIZE} total={activeTotal} />
    </div>
  );
}
