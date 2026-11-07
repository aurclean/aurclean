import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  DeleteRateButton,
  DeleteScheduleButton,
  GenerateStatementDialog,
  NewContractDialog,
  RateCardDialog,
  ScheduleDialog,
  WEEKDAYS,
} from "@/app/(app)/b2b/b2b-dialogs";
import { prisma } from "@/lib/prisma";
import { formatCurrency, num } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { assertFirmAccess, hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { humanize } from "@/lib/utils";

export const metadata = { title: "Corporate account" };

export default async function B2BAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePermission(PERMISSIONS.B2B_VIEW);

  const account = await prisma.b2BAccount.findFirst({
    where: { OR: [{ id }, { code: id }] },
    include: {
      branch: { select: { name: true } },
      contracts: {
        orderBy: { startDate: "desc" },
        include: {
          rateCards: {
            orderBy: { effectiveFrom: "desc" },
            include: {
              service: { select: { name: true } },
              garmentType: { select: { name: true } },
            },
          },
        },
      },
      schedules: { orderBy: [{ type: "asc" }, { dayOfWeek: "asc" }] },
      statements: { orderBy: { periodStart: "desc" }, take: 12 },
      orders: {
        orderBy: { placedAt: "desc" },
        take: 25,
        select: {
          id: true,
          orderNumber: true,
          placedAt: true,
          status: true,
          paymentStatus: true,
          totalPieces: true,
          totalAmount: true,
          outstandingAmount: true,
        },
      },
      invoices: { orderBy: { issuedAt: "desc" }, take: 12 },
    },
  });

  if (!account) notFound();
  assertFirmAccess(user, account.firmId);
  const firmId = requireFirmId(user);

  const [services, garmentTypes, lifetime] = await Promise.all([
    prisma.service.findMany({
      where: { firmId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.garmentType.findMany({
      where: { firmId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.order.aggregate({
      where: { b2bAccountId: account.id, status: { notIn: ["CANCELLED", "REFUNDED"] } },
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
  ]);

  const canManage = hasPermission(user, PERMISSIONS.B2B_MANAGE);
  const canBill = hasPermission(user, PERMISSIONS.B2B_BILLING);
  const activeContract = account.contracts.find((contract) => contract.status === "ACTIVE");

  return (
    <div className="space-y-5">
      <PageHeader
        title={account.businessName}
        description={`${humanize(account.type)} · ${account.code}${account.branch ? ` · ${account.branch.name}` : ""}`}
        actions={
          <>
            <Button asChild variant="outline" size="icon" aria-label="Back to B2B">
              <Link href="/b2b">
                <ArrowLeft />
              </Link>
            </Button>
            {canBill ? <GenerateStatementDialog accountId={account.id} /> : null}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={account.isActive ? "ACTIVE" : "INACTIVE"} dot />
          <span className="text-sm text-muted-foreground">
            {account.creditDays} day terms
          </span>
          {account.paymentTerms ? (
            <span className="text-sm text-muted-foreground">{account.paymentTerms}</span>
          ) : null}
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Orders" value={lifetime._count._all} />
        <StatCard
          label="Lifetime value"
          value={formatCurrency(lifetime._sum.totalAmount ?? 0)}
          tone="success"
        />
        <StatCard
          label="Outstanding"
          value={formatCurrency(account.outstandingBalance)}
          tone={num(account.outstandingBalance) > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Credit limit"
          value={
            num(account.creditLimit) > 0
              ? formatCurrency(account.creditLimit)
              : "No limit"
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {[
              ["Contact", account.contactPerson],
              ["Phone", account.phone],
              ["Email", account.email],
              ["GSTIN", account.gstNumber],
              ["Branch", account.branch?.name],
            ].map(([label, value]) => (
              <div key={label as string} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right">{value || "—"}</dd>
              </div>
            ))}
            {account.billingAddress ? (
              <>
                <Separator />
                <p className="text-muted-foreground">{account.billingAddress}</p>
              </>
            ) : null}
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <Tabs defaultValue="contracts">
            <TabsList className="flex-wrap">
              <TabsTrigger value="contracts">Contracts & rates</TabsTrigger>
              <TabsTrigger value="schedules">Schedules</TabsTrigger>
              <TabsTrigger value="orders">Orders</TabsTrigger>
              <TabsTrigger value="statements">Statements</TabsTrigger>
            </TabsList>

            <TabsContent value="contracts" className="space-y-4">
              {canManage ? (
                <div className="flex justify-end">
                  <NewContractDialog accountId={account.id} />
                </div>
              ) : null}

              {account.contracts.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    No contracts yet. Orders will fall back to standard pricing.
                  </CardContent>
                </Card>
              ) : (
                account.contracts.map((contract) => (
                  <Card key={contract.id}>
                    <CardHeader className="flex-row items-start justify-between space-y-0">
                      <div>
                        <CardTitle className="font-mono text-base">
                          {contract.contractNumber}
                        </CardTitle>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatDate(contract.startDate)} –{" "}
                          {contract.endDate ? formatDate(contract.endDate) : "open ended"} ·{" "}
                          {humanize(contract.billingCycle)}
                          {num(contract.minimumMonthlyValue) > 0
                            ? ` · min ${formatCurrency(contract.minimumMonthlyValue)}/month`
                            : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={contract.status} />
                        {canManage ? (
                          <RateCardDialog
                            contractId={contract.id}
                            services={services}
                            garmentTypes={garmentTypes}
                          />
                        ) : null}
                      </div>
                    </CardHeader>
                    <CardContent>
                      {contract.rateCards.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No contracted rates — standard pricing applies.
                        </p>
                      ) : (
                        <ul className="divide-y divide-border rounded-lg border border-border">
                          {contract.rateCards.map((rate) => (
                            <li
                              key={rate.id}
                              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                            >
                              <div className="min-w-0">
                                <p className="font-medium">
                                  {rate.service.name}
                                  {rate.garmentType ? ` · ${rate.garmentType.name}` : " · all garments"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {humanize(rate.pricingMode)} · from{" "}
                                  {formatDate(rate.effectiveFrom)}
                                  {rate.effectiveTo ? ` to ${formatDate(rate.effectiveTo)}` : ""}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold numeric">
                                  {formatCurrency(rate.rate)}
                                </span>
                                {canManage ? <DeleteRateButton rateCardId={rate.id} /> : null}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                      {contract.terms ? (
                        <p className="mt-3 whitespace-pre-wrap text-xs text-muted-foreground">
                          {contract.terms}
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            <TabsContent value="schedules" className="space-y-4">
              {canManage ? (
                <div className="flex justify-end">
                  <ScheduleDialog accountId={account.id} />
                </div>
              ) : null}
              <Card>
                <CardContent className="pt-5">
                  {account.schedules.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No standing pickup or delivery slots.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {account.schedules.map((schedule) => (
                        <li
                          key={schedule.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                        >
                          <StatusBadge status={schedule.type} tone="info" />
                          <span className="font-medium">{WEEKDAYS[schedule.dayOfWeek]}</span>
                          <span className="text-muted-foreground">{schedule.timeSlot}</span>
                          {canManage ? (
                            <DeleteScheduleButton scheduleId={schedule.id} />
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="orders">
              <Card>
                <CardContent className="overflow-x-auto p-0">
                  {account.orders.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No orders booked for this account yet.
                    </p>
                  ) : (
                    <table className="w-full min-w-[420px] text-sm">
                      <thead>
                        <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="px-4 py-2.5 text-left">Order</th>
                          <th className="px-4 py-2.5 text-left">Placed</th>
                          <th className="px-4 py-2.5 text-left">Status</th>
                          <th className="px-4 py-2.5 text-right">Pieces</th>
                          <th className="px-4 py-2.5 text-right">Value</th>
                          <th className="px-4 py-2.5 text-right">Due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {account.orders.map((order) => (
                          <tr key={order.id} className="border-b border-border last:border-0">
                            <td className="px-4 py-2.5">
                              <Link
                                href={`/orders/${order.id}`}
                                className="font-mono text-primary hover:underline"
                              >
                                {order.orderNumber}
                              </Link>
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground">
                              {formatDate(order.placedAt)}
                            </td>
                            <td className="px-4 py-2.5">
                              <StatusBadge status={order.status} />
                            </td>
                            <td className="px-4 py-2.5 text-right numeric">
                              {order.totalPieces}
                            </td>
                            <td className="px-4 py-2.5 text-right numeric">
                              {formatCurrency(order.totalAmount)}
                            </td>
                            <td className="px-4 py-2.5 text-right numeric">
                              {formatCurrency(order.outstandingAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="statements">
              <Card>
                <CardContent className="pt-5">
                  {account.statements.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No statements generated yet.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {account.statements.map((statement) => (
                        <li
                          key={statement.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                        >
                          <span className="font-mono font-semibold">
                            {statement.statementNumber}
                          </span>
                          <span className="text-muted-foreground">
                            {formatDate(statement.periodStart)} –{" "}
                            {formatDate(statement.periodEnd)}
                          </span>
                          <span className="text-muted-foreground numeric">
                            {statement.orderCount} orders
                          </span>
                          <span className="font-semibold numeric">
                            {formatCurrency(statement.totalAmount)}
                          </span>
                          <StatusBadge status={statement.status} />
                        </li>
                      ))}
                    </ul>
                  )}

                  {account.invoices.length > 0 ? (
                    <>
                      <Separator className="my-4" />
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Invoices
                      </h3>
                      <ul className="space-y-2">
                        {account.invoices.map((invoice) => (
                          <li key={invoice.id}>
                            <Link
                              href={`/billing/invoices/${invoice.id}`}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/40"
                            >
                              <span className="font-mono">{invoice.invoiceNumber}</span>
                              <span className="text-muted-foreground">
                                {formatDate(invoice.issuedAt)}
                              </span>
                              <span className="numeric">
                                {formatCurrency(invoice.totalAmount)}
                              </span>
                              <StatusBadge status={invoice.status} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
