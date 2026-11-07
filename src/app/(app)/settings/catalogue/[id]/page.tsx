import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock3, IndianRupee, Layers, Shirt } from "lucide-react";

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
import { formatDate } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { STAGE_LABELS } from "@/lib/workflow";
import { humanize } from "@/lib/utils";

export const metadata = { title: "Service" };

interface RateRow {
  id: string;
  garmentType: string;
  price: number;
}

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePermission(PERMISSIONS.CATALOGUE_MANAGE);

  const [service, recentOrders, pieceCount] = await Promise.all([
    prisma.service.findFirst({
      where: { firmId: requireFirmId(user), OR: [{ id }, { code: id }] },
      include: {
        rates: {
          include: { garmentType: { select: { name: true } } },
          orderBy: { garmentType: { name: "asc" } },
        },
        _count: { select: { orderItems: true, garments: true, rateCards: true } },
      },
    }),
    prisma.orderItem.findMany({
      where: { serviceId: id },
      orderBy: { order: { placedAt: "desc" } },
      take: 12,
      select: {
        id: true,
        quantity: true,
        lineTotal: true,
        garmentType: { select: { name: true } },
        order: {
          select: {
            id: true,
            orderNumber: true,
            customerName: true,
            placedAt: true,
            status: true,
          },
        },
      },
    }),
    prisma.garment.count({ where: { serviceId: id } }),
  ]);

  if (!service) notFound();

  const revenue = await prisma.orderItem.aggregate({
    where: { serviceId: id, order: { status: { notIn: ["CANCELLED"] } } },
    _sum: { lineTotal: true },
  });

  const rateRows: RateRow[] = service.rates.map((rate) => ({
    id: rate.id,
    garmentType: rate.garmentType.name,
    price: num(rate.price),
  }));

  const rateColumns: Column<RateRow>[] = [
    { key: "type", header: "Garment type", cell: (row) => row.garmentType },
    {
      key: "price",
      header: "Rate",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => <span className="numeric">{formatCurrency(row.price)}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={service.name}
        description={`${service.code} · ${humanize(service.pricingMode)} · ${service.turnaroundHours}h turnaround`}
        actions={
          <>
            <Button asChild variant="outline" size="icon" aria-label="Back to catalogue">
              <Link href="/settings/catalogue">
                <ArrowLeft />
              </Link>
            </Button>
            {hasPermission(user, PERMISSIONS.CATALOGUE_MANAGE) ? (
              <Button asChild>
                <Link href={`/settings/catalogue?edit=${service.id}`}>Edit service</Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        {service.isActive ? (
          <Badge tone="success">Offered</Badge>
        ) : (
          <Badge tone="neutral">Retired</Badge>
        )}
        {service.stages.map((stage) => (
          <Badge key={stage} tone="outline">
            {STAGE_LABELS[stage]}
          </Badge>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Base price"
          value={formatCurrency(service.basePrice)}
          icon={IndianRupee}
          animate={false}
        />
        <StatCard label="Order lines" value={service._count.orderItems} icon={Layers} />
        <StatCard label="Garments handled" value={pieceCount} icon={Shirt} />
        <StatCard
          label="Lifetime revenue"
          value={formatCurrency(num(revenue._sum.lineTotal))}
          tone="success"
          animate={false}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Rate card</CardTitle>
            <p className="text-sm text-muted-foreground">
              A garment-specific rate beats the base price at order entry.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable
              columns={rateColumns}
              rows={rateRows}
              getRowKey={(row) => row.id}
              className="rounded-none border-0"
              empty={
                <EmptyState
                  title="No garment rates"
                  description={`Everything is charged at the ${formatCurrency(service.basePrice)} base price.`}
                />
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="size-4" /> Recent orders
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentOrders.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nothing has been booked against this service yet.
              </p>
            ) : (
              recentOrders.map((line) => (
                <Link
                  key={line.id}
                  href={`/orders/${line.order.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-muted/40"
                >
                  <span className="min-w-0">
                    <span className="font-mono font-medium">{line.order.orderNumber}</span>
                    <span className="ml-2 text-muted-foreground">
                      {line.quantity}× {line.garmentType.name} · {line.order.customerName}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={line.order.status} />
                    <span className="numeric text-xs text-muted-foreground">
                      {formatDate(line.order.placedAt)}
                    </span>
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {service.description ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {service.description}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
