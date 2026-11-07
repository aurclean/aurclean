import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/shared/status-badge";
import { PrintButton } from "@/components/shared/print-button";
import { DocumentActionBar } from "@/components/documents/document-action-bar";
import { QrCode } from "@/components/shared/code-image";
import { prisma } from "@/lib/prisma";
import { formatCurrency, num } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { buildOrderQrPayload } from "@/lib/codes";
import { PERMISSIONS } from "@/lib/rbac";
import { assertBranchAccess, assertFirmAccess, requirePermission } from "@/lib/session";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePermission(PERMISSIONS.BILLING_VIEW);

  const invoice = await prisma.invoice.findFirst({
    where: { OR: [{ id }, { invoiceNumber: id }] },
    include: {
      branch: true,
      order: { select: { id: true, orderNumber: true, totalPieces: true, expectedDeliveryAt: true } },
      b2bAccount: { select: { businessName: true, gstNumber: true, billingAddress: true } },
      lines: { orderBy: { createdAt: "asc" } },
      payments: {
        where: { state: "CAPTURED" },
        orderBy: { paidAt: "asc" },
        include: { receivedBy: { select: { name: true } } },
      },
      issuedBy: { select: { name: true } },
    },
  });

  if (!invoice) notFound();
  assertBranchAccess(user, invoice.branchId);
  assertFirmAccess(user, invoice.firmId);

  const gstTotal =
    num(invoice.cgstAmount) + num(invoice.sgstAmount) + num(invoice.igstAmount);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Invoice {invoice.invoiceNumber}
          </h1>
          <p className="text-sm text-muted-foreground">
            Issued {formatDateTime(invoice.issuedAt)}
            {invoice.issuedBy ? ` by ${invoice.issuedBy.name}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href={invoice.order ? `/orders/${invoice.order.id}` : "/billing"}>
              <ArrowLeft /> Back
            </Link>
          </Button>
          <DocumentActionBar
            documentType="INVOICE"
            documentId={invoice.id}
            documentNumber={invoice.invoiceNumber}
            customerPhone={invoice.billToPhone ?? undefined}
            customerName={invoice.billToName ?? undefined}
            orderNumber={invoice.order?.orderNumber}
            pdfUrl={`/api/documents/pdf?type=INVOICE&id=${invoice.id}`}
          />
        </div>
      </div>

      <article className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-6 sm:p-8 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight">{invoice.branch.name}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[invoice.branch.addressLine, invoice.branch.city, invoice.branch.state]
                .filter(Boolean)
                .join(", ")}
              {invoice.branch.pincode ? ` — ${invoice.branch.pincode}` : ""}
            </p>
            {invoice.branch.phone ? (
              <p className="text-sm text-muted-foreground">{invoice.branch.phone}</p>
            ) : null}
            {invoice.branch.gstNumber ? (
              <p className="text-sm text-muted-foreground">
                GSTIN: <span className="font-mono">{invoice.branch.gstNumber}</span>
              </p>
            ) : null}
          </div>

          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tax Invoice
            </p>
            <p className="font-mono text-lg font-bold">{invoice.invoiceNumber}</p>
            <p className="text-sm text-muted-foreground">
              {formatDate(invoice.issuedAt)}
            </p>
            <div className="mt-2 flex justify-end">
              <StatusBadge status={invoice.status} />
            </div>
          </div>
        </header>

        <Separator className="my-5" />

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Billed to
            </p>
            <p className="mt-1 font-medium">
              {invoice.b2bAccount?.businessName ?? invoice.billToName}
            </p>
            {invoice.billToPhone ? (
              <p className="font-mono text-sm text-muted-foreground">
                {invoice.billToPhone}
              </p>
            ) : null}
            {invoice.billToEmail ? (
              <p className="text-sm text-muted-foreground">{invoice.billToEmail}</p>
            ) : null}
            {invoice.b2bAccount?.billingAddress ?? invoice.billToAddress ? (
              <p className="text-sm text-muted-foreground">
                {invoice.b2bAccount?.billingAddress ?? invoice.billToAddress}
              </p>
            ) : null}
            {invoice.b2bAccount?.gstNumber ?? invoice.billToGstin ? (
              <p className="text-sm text-muted-foreground">
                GSTIN:{" "}
                <span className="font-mono">
                  {invoice.b2bAccount?.gstNumber ?? invoice.billToGstin}
                </span>
              </p>
            ) : null}
          </div>

          <div className="sm:text-right">
            {invoice.order ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Order
                </p>
                <p className="font-mono font-medium">{invoice.order.orderNumber}</p>
                <p className="text-sm text-muted-foreground">
                  {invoice.order.totalPieces} garments · due{" "}
                  {formatDate(invoice.order.expectedDeliveryAt)}
                </p>
                <div className="mt-2 flex sm:justify-end">
                  <QrCode value={buildOrderQrPayload(invoice.order.orderNumber)} size={84} />
                </div>
              </>
            ) : invoice.periodStart && invoice.periodEnd ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Billing period
                </p>
                <p className="font-medium">
                  {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}
                </p>
              </>
            ) : null}
          </div>
        </section>

        <Separator className="my-5" />

        <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 text-left">Description</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Rate</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id} className="border-b border-border last:border-0">
                <td className="py-2.5">{line.description}</td>
                <td className="py-2.5 text-right numeric">{num(line.quantity)}</td>
                <td className="py-2.5 text-right numeric">{formatCurrency(line.unitPrice)}</td>
                <td className="py-2.5 text-right numeric">{formatCurrency(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        <div className="mt-5 flex justify-end">
          <dl className="w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="numeric">{formatCurrency(invoice.subtotal)}</dd>
            </div>
            {num(invoice.discountAmount) > 0 ? (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Discount</dt>
                <dd className="numeric">−{formatCurrency(invoice.discountAmount)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Taxable value</dt>
              <dd className="numeric">{formatCurrency(invoice.taxableAmount)}</dd>
            </div>
            {num(invoice.igstAmount) > 0 ? (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">IGST ({num(invoice.gstRate)}%)</dt>
                <dd className="numeric">{formatCurrency(invoice.igstAmount)}</dd>
              </div>
            ) : (
              <>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">
                    CGST ({num(invoice.gstRate) / 2}%)
                  </dt>
                  <dd className="numeric">{formatCurrency(invoice.cgstAmount)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">
                    SGST ({num(invoice.gstRate) / 2}%)
                  </dt>
                  <dd className="numeric">{formatCurrency(invoice.sgstAmount)}</dd>
                </div>
              </>
            )}
            <Separator />
            <div className="flex justify-between text-base font-semibold">
              <dt>Total</dt>
              <dd className="numeric">{formatCurrency(invoice.totalAmount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Paid</dt>
              <dd className="numeric text-success">{formatCurrency(invoice.amountPaid)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>Balance due</dt>
              <dd className="numeric text-destructive">
                {formatCurrency(invoice.amountDue)}
              </dd>
            </div>
          </dl>
        </div>

        {invoice.payments.length > 0 ? (
          <>
            <Separator className="my-5" />
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Payments received
              </h3>
              <ul className="space-y-1 text-sm">
                {invoice.payments.map((payment) => (
                  <li key={payment.id} className="flex justify-between">
                    <span className="text-muted-foreground">
                      {formatDate(payment.paidAt)} · {payment.method}
                      {payment.reference ? ` · ${payment.reference}` : ""}
                      {payment.receivedBy ? ` · ${payment.receivedBy.name}` : ""}
                    </span>
                    <span className="numeric">{formatCurrency(payment.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}

        <Separator className="my-5" />

        <footer className="space-y-1 text-xs text-muted-foreground">
          {invoice.notes ? <p>{invoice.notes}</p> : null}
          <p>
            Amount in words is payable on the stated terms. Goods not collected within
            30 days of the ready date may attract storage charges.
          </p>
          <p>This is a computer-generated invoice and is valid without a signature.</p>
        </footer>
      </article>
    </div>
  );
}
