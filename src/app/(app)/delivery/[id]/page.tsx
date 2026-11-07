import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  MapPin,
  Package,
  Phone,
  Truck,
  User,
  Wallet,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Timeline, type TimelineEntry } from "@/components/shared/timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { formatCurrency, num } from "@/lib/money";
import { formatDateTime, formatTime } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { assertBranchAccess, assertFirmAccess, hasPermission, requirePermission } from "@/lib/session";
import { humanize } from "@/lib/utils";

import { CancelDeliveryButton } from "@/app/(app)/delivery/delivery-row-actions";

export const metadata = { title: "Delivery" };

export default async function DeliveryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePermission(PERMISSIONS.DELIVERY_VIEW);

  const delivery = await prisma.delivery.findUnique({
    where: { id },
    include: {
      branch: { select: { name: true } },
      driver: { select: { id: true, user: { select: { name: true, phone: true } } } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          customerId: true,
          customerName: true,
          customerPhone: true,
          status: true,
          totalPieces: true,
          totalAmount: true,
          outstandingAmount: true,
          expectedDeliveryAt: true,
          garments: {
            select: {
              id: true,
              garmentCode: true,
              status: true,
              garmentType: { select: { name: true } },
            },
            orderBy: { garmentCode: "asc" },
          },
        },
      },
    },
  });

  if (!delivery) notFound();
  assertBranchAccess(user, delivery.branchId);
  assertFirmAccess(user, delivery.firmId);

  const timeline: TimelineEntry[] = [
    {
      id: "scheduled",
      time: formatTime(delivery.scheduledAt),
      title: "Scheduled",
      description: null,
      meta: formatDateTime(delivery.scheduledAt),
      tone: "default",
    },
    ...(delivery.dispatchedAt
      ? [
          {
            id: "dispatched",
            time: formatTime(delivery.dispatchedAt),
            title: "Out for delivery",
            description: delivery.driver?.user.name
              ? `With ${delivery.driver.user.name}`
              : null,
            meta: formatDateTime(delivery.dispatchedAt),
            tone: "default" as const,
          },
        ]
      : []),
    ...(delivery.deliveredAt
      ? [
          {
            id: "delivered",
            time: formatTime(delivery.deliveredAt),
            title: "Delivered",
            description: delivery.receivedByName
              ? `Received by ${delivery.receivedByName}`
              : null,
            meta: formatDateTime(delivery.deliveredAt),
            tone: "success" as const,
          },
        ]
      : []),
    ...(delivery.status === "FAILED" || delivery.status === "CANCELLED"
      ? [
          {
            id: "failed",
            time: formatTime(delivery.updatedAt),
            title: humanize(delivery.status),
            description: delivery.failureReason,
            meta: formatDateTime(delivery.updatedAt),
            tone: "danger" as const,
          },
        ]
      : []),
  ];

  const open = !["DELIVERED", "CANCELLED"].includes(delivery.status);

  return (
    <div className="space-y-5">
      <PageHeader
        title={delivery.deliveryNumber}
        description={`${delivery.branch.name} · scheduled ${formatDateTime(delivery.scheduledAt)}`}
        actions={
          <>
            <Button asChild variant="outline" size="icon" aria-label="Back to delivery">
              <Link href="/delivery">
                <ArrowLeft />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/orders/${delivery.order.id}`}>View order</Link>
            </Button>
            {open && hasPermission(user, PERMISSIONS.DELIVERY_MANAGE) ? (
              <CancelDeliveryButton
                deliveryId={delivery.id}
                deliveryNumber={delivery.deliveryNumber}
              />
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={delivery.status} label={humanize(delivery.status)} />
        {delivery.attemptCount > 1 ? (
          <Badge tone="warning">{delivery.attemptCount} attempts</Badge>
        ) : null}
        {num(delivery.amountToCollect) > 0 ? (
          <Badge tone="info">
            {formatCurrency(delivery.amountToCollect)} to collect
          </Badge>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Garments" value={delivery.garmentCount} icon={Package} />
        <StatCard
          label="To collect"
          value={formatCurrency(delivery.amountToCollect)}
          icon={Wallet}
          animate={false}
        />
        <StatCard
          label="Collected"
          value={formatCurrency(delivery.amountCollected)}
          tone="success"
          animate={false}
        />
        <StatCard
          label="Attempts"
          value={delivery.attemptCount}
          icon={Truck}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Run</CardTitle>
            </CardHeader>
            <CardContent>
              <Timeline entries={timeline} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Garments on this run ({delivery.order.garments.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {delivery.order.garments.map((garment) => (
                <Link
                  key={garment.id}
                  href={`/garments/${garment.garmentCode}`}
                  className="press flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm transition-colors hover:bg-accent"
                >
                  <span className="font-mono font-medium">{garment.garmentCode}</span>
                  <span className="text-muted-foreground">{garment.garmentType.name}</span>
                  <StatusBadge status={garment.status} />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="size-4" /> Deliver to
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="font-medium">
                {delivery.order.customerId ? (
                  <Link
                    href={`/customers/${delivery.order.customerId}`}
                    className="text-primary hover:underline"
                  >
                    {delivery.contactName}
                  </Link>
                ) : (
                  delivery.contactName
                )}
              </p>
              <p className="flex items-center gap-2">
                <Phone className="size-4 text-muted-foreground" />
                <span className="font-mono">{delivery.contactPhone}</span>
              </p>
              <p className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  {delivery.addressLine}
                  {delivery.landmark ? `, near ${delivery.landmark}` : ""}
                </span>
              </p>
              {delivery.notes ? (
                <p className="rounded-lg bg-muted px-3 py-2">{delivery.notes}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Truck className="size-4" /> Driver
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {delivery.driver ? (
                <>
                  <p className="font-medium">{delivery.driver.user.name}</p>
                  {delivery.driver.user.phone ? (
                    <p className="font-mono text-muted-foreground">
                      {delivery.driver.user.phone}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-muted-foreground">Not assigned yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
