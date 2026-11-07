import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, Printer, Receipt, User } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentActionBar } from "@/components/documents/document-action-bar";
import { prisma } from "@/lib/prisma";
import { formatCurrency, num } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { assertBranchAccess, assertFirmAccess, hasPermission, requirePermission } from "@/lib/session";
import { humanize } from "@/lib/utils";

import { VoidPaymentButton } from "@/app/(app)/billing/payment-actions";

export const metadata = { title: "Payment" };

export default async function PaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePermission(PERMISSIONS.BILLING_VIEW);

  const payment = await prisma.payment.findFirst({
    where: { OR: [{ id }, { paymentNumber: id }] },
    include: {
      branch: { select: { name: true, code: true } },
      receivedBy: { select: { name: true } },
      invoice: { select: { id: true, invoiceNumber: true } },
      refunds: {
        orderBy: { createdAt: "desc" },
        include: { processedBy: { select: { name: true } } },
      },
      order: {
        select: {
          id: true,
          orderNumber: true,
          customerId: true,
          customerName: true,
          customerPhone: true,
          totalAmount: true,
          paidAmount: true,
          outstandingAmount: true,
          status: true,
          totalPieces: true,
        },
      },
    },
  });

  if (!payment) notFound();
  assertBranchAccess(user, payment.branchId);
  assertFirmAccess(user, payment.firmId);

  const refunded = payment.refunds
    .filter((refund) => refund.status === "PROCESSED")
    .reduce((sum, refund) => sum + num(refund.amount), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title={payment.paymentNumber}
        description={`${humanize(payment.method)} · ${formatDateTime(payment.paidAt)} · ${payment.branch.name}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="icon" aria-label="Back to billing">
              <Link href="/billing?tab=payments">
                <ArrowLeft />
              </Link>
            </Button>
            <DocumentActionBar
              documentType="PAYMENT_RECEIPT"
              documentId={payment.id}
              documentNumber={payment.paymentNumber}
              customerPhone={payment.order?.customerPhone}
              customerName={payment.order?.customerName}
              orderNumber={payment.order?.orderNumber}
              pdfUrl={`/api/documents/pdf?type=PAYMENT_RECEIPT&id=${payment.id}`}
            />
            {hasPermission(user, PERMISSIONS.BILLING_REFUND) &&
            payment.state === "CAPTURED" &&
            payment.refunds.length === 0 ? (
              <VoidPaymentButton
                paymentId={payment.id}
                paymentNumber={payment.paymentNumber}
                amount={formatCurrency(payment.amount)}
              />
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={payment.state} label={humanize(payment.state)} />
        <Badge tone="outline">{humanize(payment.provider)}</Badge>
        {payment.isAdvance ? <Badge tone="info">Advance</Badge> : null}
        {refunded > 0 ? (
          <Badge tone="warning">{formatCurrency(refunded)} refunded</Badge>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Amount"
          value={formatCurrency(payment.amount)}
          icon={Receipt}
          tone={payment.state === "CANCELLED" ? "danger" : "success"}
          animate={false}
        />
        <StatCard
          label="Order total"
          value={payment.order ? formatCurrency(payment.order.totalAmount) : "—"}
          animate={false}
        />
        <StatCard
          label="Still outstanding"
          value={payment.order ? formatCurrency(payment.order.outstandingAmount) : "—"}
          tone={
            payment.order && num(payment.order.outstandingAmount) > 0 ? "warning" : "default"
          }
          animate={false}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Method" value={humanize(payment.method)} />
            <Row label="Taken" value={formatDateTime(payment.paidAt)} />
            <Row label="Taken by" value={payment.receivedBy?.name ?? "—"} />
            <Row label="Branch" value={payment.branch.name} />
            <Row label="Reference" value={payment.reference ?? "—"} />
            {payment.invoice ? (
              <Row
                label="Invoice"
                value={
                  <Link
                    href={`/billing/invoices/${payment.invoice.id}`}
                    className="font-mono text-primary hover:underline"
                  >
                    {payment.invoice.invoiceNumber}
                  </Link>
                }
              />
            ) : null}
            {payment.notes ? (
              <p className="rounded-lg bg-muted px-3 py-2">{payment.notes}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <User className="size-4" /> Order and customer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {payment.order ? (
              <>
                <Row
                  label="Order"
                  value={
                    <Link
                      href={`/orders/${payment.order.id}`}
                      className="font-mono text-primary hover:underline"
                    >
                      {payment.order.orderNumber}
                    </Link>
                  }
                />
                <Row
                  label="Customer"
                  value={
                    payment.order.customerId ? (
                      <Link
                        href={`/customers/${payment.order.customerId}`}
                        className="text-primary hover:underline"
                      >
                        {payment.order.customerName}
                      </Link>
                    ) : (
                      payment.order.customerName
                    )
                  }
                />
                <Row label="Phone" value={payment.order.customerPhone} />
                <Row label="Pieces" value={String(payment.order.totalPieces)} />
                <Row
                  label="Order status"
                  value={<StatusBadge status={payment.order.status} />}
                />
              </>
            ) : (
              <p className="text-muted-foreground">
                This payment is not linked to an order.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {payment.refunds.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Ban className="size-4" /> Refunds against this payment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {payment.refunds.map((refund) => (
              <div
                key={refund.id}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-mono">{refund.refundNumber}</span>
                  <span className="ml-2 text-muted-foreground">
                    {refund.reason ?? "No reason given"}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <StatusBadge status={refund.status} />
                  <span className="numeric font-medium">
                    {formatCurrency(refund.amount)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(refund.createdAt)}
                    {refund.processedBy ? ` · ${refund.processedBy.name}` : ""}
                  </span>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
