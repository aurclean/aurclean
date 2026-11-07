import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Banknote,
  MapPin,
  Phone,
  Printer,
  Receipt,
  Shirt,
  Tag,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type Column } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Timeline, type TimelineEntry } from "@/components/shared/timeline";
import { CopyButton } from "@/components/shared/copy-button";
import { OrderActions } from "@/app/(app)/orders/[id]/order-actions";
import { OrderDeliveryChallanSection } from "@/app/(app)/orders/[id]/order-delivery-challan";
import { DocumentActionBar } from "@/components/documents/document-action-bar";
import { prisma } from "@/lib/prisma";
import { formatCurrency, num } from "@/lib/money";
import { formatDateTime, formatTime } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { assertBranchAccess, assertFirmAccess, hasPermission, requirePermission } from "@/lib/session";
import { humanize } from "@/lib/utils";
import {
  GARMENT_STATUS_LABELS,
  ORDER_STATUS_TRANSITIONS,
  STAGE_LABELS,
  toneFor,
} from "@/lib/workflow";

export const metadata = { title: "Order" };

interface GarmentRow {
  id: string;
  garmentCode: string;
  typeName: string;
  serviceName: string;
  status: string;
  stage: string;
  lastScannedAt: Date | null;
  scannedBy: string | null;
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePermission(PERMISSIONS.ORDER_VIEW);

  const order = await prisma.order.findFirst({
    where: { OR: [{ id }, { orderNumber: id }] },
    include: {
      branch: { select: { id: true, name: true, code: true } },
      b2bAccount: { select: { id: true, businessName: true, code: true } },
      createdBy: { select: { name: true } },
      items: {
        include: {
          service: { select: { name: true } },
          garmentType: { select: { name: true } },
        },
      },
      garments: {
        orderBy: { garmentCode: "asc" },
        include: {
          garmentType: { select: { name: true } },
          service: { select: { name: true } },
          lastScannedBy: { select: { name: true } },
        },
      },
      statusHistory: { orderBy: { createdAt: "asc" } },
      payments: {
        orderBy: { paidAt: "desc" },
        include: { receivedBy: { select: { name: true } } },
      },
      invoices: { orderBy: { issuedAt: "desc" }, select: { id: true, invoiceNumber: true } },
      deliveries: { orderBy: { scheduledAt: "desc" }, include: { driver: { include: { user: { select: { name: true } } } } } },
      pickups: { orderBy: { scheduledAt: "desc" }, include: { driver: { include: { user: { select: { name: true } } } } } },
      complaints: { orderBy: { createdAt: "desc" }, select: { id: true, complaintNumber: true, type: true, status: true } },
      deliveryChallans: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!order) notFound();
  assertFirmAccess(user, order.firmId);
  assertBranchAccess(user, order.branchId);

  const deliveryPolicy = await prisma.setting.findUnique({
    where: { firmId_key: { firmId: order.firmId, key: "require_full_payment_before_delivery" } },
  });
  const requireFullPaymentBeforeDelivery = deliveryPolicy?.value === "true";

  const canSeeMoney = hasPermission(user, [
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.DASHBOARD_VIEW_FINANCIALS,
  ]);
  const canUpdate = hasPermission(user, PERMISSIONS.ORDER_UPDATE);
  const canCancel = hasPermission(user, PERMISSIONS.ORDER_CANCEL);
  const canRefund = hasPermission(user, PERMISSIONS.BILLING_REFUND);

  const isDelayed =
    order.expectedDeliveryAt < new Date() &&
    !["DELIVERED", "CANCELLED", "REFUNDED"].includes(order.status);

  const garmentRows: GarmentRow[] = order.garments.map((garment) => ({
    id: garment.id,
    garmentCode: garment.garmentCode,
    typeName: garment.garmentType.name,
    serviceName: garment.service.name,
    status: garment.status,
    stage: garment.currentStage,
    lastScannedAt: garment.lastScannedAt,
    scannedBy: garment.lastScannedBy?.name ?? null,
  }));

  const garmentColumns: Column<GarmentRow>[] = [
    {
      key: "code",
      header: "Garment",
      cell: (row) => (
        <Link
          href={`/garments/${row.garmentCode}`}
          className="font-mono text-sm font-semibold text-primary hover:underline"
        >
          {row.garmentCode}
        </Link>
      ),
    },
    { key: "type", header: "Type", cell: (row) => <span className="text-sm">{row.typeName}</span> },
    {
      key: "service",
      header: "Service",
      hideOnMobile: true,
      cell: (row) => <span className="text-sm text-muted-foreground">{row.serviceName}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <StatusBadge
          status={row.status}
          label={GARMENT_STATUS_LABELS[row.status as keyof typeof GARMENT_STATUS_LABELS]}
          dot
        />
      ),
    },
    {
      key: "stage",
      header: "Stage",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {STAGE_LABELS[row.stage as keyof typeof STAGE_LABELS]}
        </span>
      ),
    },
    {
      key: "scan",
      header: "Last scan",
      hideOnMobile: true,
      cell: (row) =>
        row.lastScannedAt ? (
          <div className="text-xs text-muted-foreground">
            <p>{formatDateTime(row.lastScannedAt)}</p>
            {row.scannedBy ? <p>by {row.scannedBy}</p> : null}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  const timeline: TimelineEntry[] = order.statusHistory.map((entry) => ({
    id: entry.id,
    time: formatTime(entry.createdAt),
    title: humanize(entry.toStatus),
    description: entry.note,
    meta: `${formatDateTime(entry.createdAt)}${entry.userName ? ` · ${entry.userName}` : ""}`,
    tone:
      toneFor(entry.toStatus) === "danger"
        ? "danger"
        : toneFor(entry.toStatus) === "success"
          ? "success"
          : "default",
  }));

  const allowedStatuses = ORDER_STATUS_TRANSITIONS[order.status].filter(
    (status) => status !== "CANCELLED" && status !== "REFUNDED",
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={order.orderNumber}
        description={`${order.totalPieces} garments · booked ${formatDateTime(order.placedAt)}${order.createdBy ? ` by ${order.createdBy.name}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="icon" aria-label="Back to orders">
              <Link href="/orders">
                <ArrowLeft />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/orders/${order.id}/tags`}>
                <Tag /> Print tag
              </Link>
            </Button>
            <DocumentActionBar
              documentType="ORDER_SUMMARY"
              documentId={order.id}
              documentNumber={order.orderNumber}
              customerPhone={order.customerPhone}
              customerName={order.customerName}
              orderNumber={order.orderNumber}
              pdfUrl={`/api/documents/pdf?type=ORDER_SUMMARY&id=${order.id}`}
            />
            {canSeeMoney ? (
              <Button asChild variant="outline">
                <Link href={`/orders/${order.id}/receipt`}>
                  <Printer /> Receipt
                </Link>
              </Button>
            ) : null}
            {order.invoices[0] && canSeeMoney ? (
              <Button asChild variant="outline">
                <Link href={`/billing/invoices/${order.invoices[0].id}`}>
                  <Receipt /> Invoice
                </Link>
              </Button>
            ) : null}
            <OrderActions
              orderId={order.id}
              orderNumber={order.orderNumber}
              status={order.status}
              paidAmount={num(order.paidAmount)}
              totalAmount={num(order.totalAmount)}
              outstandingAmount={num(order.outstandingAmount)}
              requireFullPaymentBeforeDelivery={requireFullPaymentBeforeDelivery}
              allowedStatuses={allowedStatuses}
              canUpdate={canUpdate}
              canCancel={canCancel}
              canRefund={canRefund}
            />
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={order.status} dot />
          <StatusBadge status={order.paymentStatus} />
          <StatusBadge status={order.type} tone="neutral" />
          {order.priority !== "NORMAL" ? <StatusBadge status={order.priority} /> : null}
          {isDelayed ? <StatusBadge status="DELAYED" tone="danger" label="Delayed" /> : null}
          {order.b2bAccount ? (
            <StatusBadge
              status="B2B"
              tone="info"
              label={`B2B · ${order.b2bAccount.businessName}`}
            />
          ) : null}
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2">
                <Shirt className="size-4" /> Garments ({order.garments.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={garmentColumns}
                rows={garmentRows}
                getRowKey={(row) => row.id}
                className="border-0"
              />
            </CardContent>
          </Card>

          <Tabs defaultValue="items">
            <TabsList>
              <TabsTrigger value="items">Line items</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="logistics">Logistics</TabsTrigger>
              {canSeeMoney ? <TabsTrigger value="payments">Payments</TabsTrigger> : null}
            </TabsList>

            <TabsContent value="items">
              <Card>
                <CardContent className="overflow-x-auto p-0">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2.5 text-left">Service</th>
                        <th className="px-4 py-2.5 text-left">Garment</th>
                        <th className="px-4 py-2.5 text-right">Qty</th>
                        <th className="px-4 py-2.5 text-right">Weight</th>
                        {canSeeMoney ? (
                          <>
                            <th className="px-4 py-2.5 text-right">Rate</th>
                            <th className="px-4 py-2.5 text-right">Total</th>
                          </>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((item) => (
                        <tr key={item.id} className="border-b border-border last:border-0">
                          <td className="px-4 py-2.5">{item.service.name}</td>
                          <td className="px-4 py-2.5">
                            {item.garmentType.name}
                            {item.notes ? (
                              <p className="text-xs text-muted-foreground">{item.notes}</p>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5 text-right numeric">{item.quantity}</td>
                          <td className="px-4 py-2.5 text-right numeric">
                            {num(item.weightKg) > 0 ? `${num(item.weightKg)} kg` : "—"}
                          </td>
                          {canSeeMoney ? (
                            <>
                              <td className="px-4 py-2.5 text-right numeric">
                                {formatCurrency(item.unitPrice)}
                              </td>
                              <td className="px-4 py-2.5 text-right font-medium numeric">
                                {formatCurrency(item.lineTotal)}
                              </td>
                            </>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="history">
              <Card>
                <CardContent className="pt-5">
                  <Timeline entries={timeline} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="logistics">
              <Card>
                <CardContent className="space-y-4 pt-5">
                  <section>
                    <h3 className="mb-2 text-sm font-semibold">Pickups</h3>
                    {order.pickups.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No pickup scheduled.</p>
                    ) : (
                      <ul className="space-y-2">
                        {order.pickups.map((pickup) => (
                          <li
                            key={pickup.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                          >
                            <span className="font-mono">{pickup.pickupNumber}</span>
                            <StatusBadge status={pickup.status} />
                            <span className="text-muted-foreground">
                              {formatDateTime(pickup.scheduledAt)}
                            </span>
                            <span className="text-muted-foreground">
                              {pickup.driver?.user.name ?? "Unassigned"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <Separator />
                  <section>
                    <h3 className="mb-2 text-sm font-semibold">Deliveries</h3>
                    {order.deliveries.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No delivery scheduled.</p>
                    ) : (
                      <ul className="space-y-2">
                        {order.deliveries.map((delivery) => (
                          <li
                            key={delivery.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                          >
                            <span className="font-mono">{delivery.deliveryNumber}</span>
                            <StatusBadge status={delivery.status} />
                            <span className="text-muted-foreground">
                              {formatDateTime(delivery.scheduledAt)}
                            </span>
                            <span className="text-muted-foreground">
                              {delivery.driver?.user.name ?? "Unassigned"}
                            </span>
                            {canSeeMoney ? (
                              <span className="numeric">
                                {formatCurrency(delivery.amountToCollect)} to collect
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  {order.complaints.length > 0 ? (
                    <>
                      <Separator />
                      <section>
                        <h3 className="mb-2 text-sm font-semibold">Complaints</h3>
                        <ul className="space-y-2">
                          {order.complaints.map((complaint) => (
                            <li key={complaint.id}>
                              <Link
                                href={`/complaints/${complaint.id}`}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/40"
                              >
                                <span className="font-mono">{complaint.complaintNumber}</span>
                                <span>{humanize(complaint.type)}</span>
                                <StatusBadge status={complaint.status} />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </section>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>

            {canSeeMoney ? (
              <TabsContent value="payments">
                <Card>
                  <CardContent className="pt-5">
                    {order.payments.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No payments recorded yet.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {order.payments.map((payment) => (
                          <li
                            key={payment.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                          >
                            <span className="font-mono">{payment.paymentNumber}</span>
                            <span className="font-medium numeric">
                              {formatCurrency(payment.amount)}
                            </span>
                            <StatusBadge status={payment.method} tone="info" />
                            <span className="text-muted-foreground">
                              {formatDateTime(payment.paidAt)}
                            </span>
                            <span className="text-muted-foreground">
                              {payment.receivedBy?.name ?? "—"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            ) : null}
          </Tabs>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="font-medium">{order.customerName}</p>
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  <Phone className="size-3.5" />
                  <a href={`tel:${order.customerPhone}`} className="font-mono hover:underline">
                    {order.customerPhone}
                  </a>
                  <CopyButton value={order.customerPhone} />
                </p>
                {order.customerEmail ? (
                  <p className="text-muted-foreground">{order.customerEmail}</p>
                ) : null}
              </div>
              {order.addressLine ? (
                <div className="flex gap-1.5 text-muted-foreground">
                  <MapPin className="mt-0.5 size-3.5 shrink-0" />
                  <p>
                    {order.addressLine}
                    {order.landmark ? `, ${order.landmark}` : ""}
                    {order.city ? `, ${order.city}` : ""}
                    {order.pincode ? ` — ${order.pincode}` : ""}
                  </p>
                </div>
              ) : null}
              <Separator />
              <dl className="space-y-1.5">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Branch</dt>
                  <dd>{order.branch.name}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Expected</dt>
                  <dd className={isDelayed ? "font-medium text-destructive" : ""}>
                    {formatDateTime(order.expectedDeliveryAt)}
                  </dd>
                </div>
                {order.readyAt ? (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Ready at</dt>
                    <dd>{formatDateTime(order.readyAt)}</dd>
                  </div>
                ) : null}
                {order.deliveredAt ? (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Delivered</dt>
                    <dd>{formatDateTime(order.deliveredAt)}</dd>
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <OrderDeliveryChallanSection
            orderId={order.id}
            orderNumber={order.orderNumber}
            customerName={order.customerName}
            customerPhone={order.customerPhone}
            challans={(order.deliveryChallans || []).map((c) => ({
              id: c.id,
              challanNumber: c.challanNumber,
              status: c.status,
              grandTotal: num(c.grandTotal),
              balanceAmount: num(c.balanceAmount),
            }))}
            canManage={canUpdate}
          />

          {canSeeMoney ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Banknote className="size-4" /> Billing
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <dl className="space-y-1.5">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Subtotal</dt>
                    <dd className="numeric">{formatCurrency(order.subtotal)}</dd>
                  </div>
                  {num(order.discountAmount) > 0 ? (
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">
                        Discount{order.discountReason ? ` (${order.discountReason})` : ""}
                      </dt>
                      <dd className="numeric text-destructive">
                        −{formatCurrency(order.discountAmount)}
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">GST ({num(order.gstRate)}%)</dt>
                    <dd className="numeric">{formatCurrency(order.gstAmount)}</dd>
                  </div>
                </dl>
                <Separator />
                <div className="flex items-baseline justify-between">
                  <span className="font-medium">Total</span>
                  <span className="text-lg font-semibold numeric">
                    {formatCurrency(order.totalAmount)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Paid</span>
                  <span className="numeric text-success">
                    {formatCurrency(order.paidAmount)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Outstanding</span>
                  <span className="font-semibold numeric text-destructive">
                    {formatCurrency(order.outstandingAmount)}
                  </span>
                </div>
                {num(order.refundedAmount) > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Refunded</span>
                    <span className="numeric">{formatCurrency(order.refundedAmount)}</span>
                  </div>
                ) : null}
                {hasPermission(user, PERMISSIONS.BILLING_RECORD_PAYMENT) &&
                num(order.outstandingAmount) > 0 ? (
                  <Button asChild className="w-full">
                    <Link href={`/billing/collect?order=${order.id}`}>
                      <Banknote /> Collect payment
                    </Link>
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {order.specialInstructions || order.stainNotes || order.damageNotes ? (
            <Card>
              <CardHeader>
                <CardTitle>Handling notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {order.specialInstructions ? (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Instructions
                    </p>
                    <p>{order.specialInstructions}</p>
                  </div>
                ) : null}
                {order.stainNotes ? (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Stains
                    </p>
                    <p>{order.stainNotes}</p>
                  </div>
                ) : null}
                {order.damageNotes ? (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Damage
                    </p>
                    <p>{order.damageNotes}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {order.cancellationReason ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-destructive">Cancelled</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p>{order.cancellationReason}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(order.cancelledAt)}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
