import Link from "next/link";
import { redirect } from "next/navigation";
import { Search as SearchIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { parseScan } from "@/lib/codes";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { GARMENT_STATUS_LABELS, STAGE_LABELS } from "@/lib/workflow";
import { param, scopedBranchId, type SearchParams } from "@/lib/queries/filters";
import {
  GARMENT_CATEGORIES,
  categorySlug,
  parseCategory,
} from "@/lib/garment-categories";

export const metadata = { title: "Search" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requirePermission(PERMISSIONS.ORDER_VIEW);
  const query = param(params, "q")?.trim();

  if (!query) {
    return (
      <div className="space-y-5">
        <PageHeader title="Search" />
        <EmptyState
          icon={SearchIcon}
          title="Search anything"
          description="A garment id (TR-1042), an order number (ORD10245), a category name (trousers), or a customer's name or phone number."
        />
      </div>
    );
  }

  const branchId = scopedBranchId(user, params);
  const firmId = requireFirmId(user);

  // Typing a category name is asking "show me every one of these and where it
  // is", which is the tracking screen, not a list of loose matches.
  const category = parseCategory(query);
  if (category) redirect(`/tracking/${categorySlug(category)}`);

  const parsed = parseScan(query);

  // A direct garment hit is the most common lookup — jump straight there.
  if (parsed.kind === "garment") {
    const garment = await prisma.garment.findUnique({
      where: { garmentCode: parsed.value },
      select: { garmentCode: true, branchId: true, firmId: true },
    });
    if (garment && garment.firmId === firmId && (!branchId || garment.branchId === branchId)) {
      redirect(`/garments/${garment.garmentCode}`);
    }
  }

  const upper = query.toUpperCase();
  const branchFilter = branchId ? { branchId } : {};

  const [orders, garments, customers] = await Promise.all([
    prisma.order.findMany({
      where: {
        firmId,
        ...branchFilter,
        OR: [
          { orderNumber: { contains: upper } },
          { customerPhone: { contains: query } },
          { customerName: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: { placedAt: "desc" },
      take: 20,
      include: {
        branch: { select: { name: true } },
      },
    }),
    prisma.garment.findMany({
      where: {
        firmId,
        ...branchFilter,
        OR: [
          { garmentCode: { contains: upper } },
          { barcodeValue: { contains: upper } },
          { order: { customerPhone: { contains: query } } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        order: { select: { id: true, orderNumber: true, customerName: true } },
        garmentType: { select: { name: true } },
      },
    }),
    hasPermission(user, PERMISSIONS.CUSTOMER_VIEW)
      ? prisma.customer.findMany({
          where: {
            firmId,
            ...(branchId ? { branchId } : {}),
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { phone: { contains: query.replace(/\D/g, "") || query } },
              { code: { contains: upper } },
            ],
          },
          orderBy: { orderCount: "desc" },
          take: 8,
          select: {
            id: true,
            name: true,
            phone: true,
            code: true,
            orderCount: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const canSeeMoney = hasPermission(user, [
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.DASHBOARD_VIEW_FINANCIALS,
  ]);
  const nothingFound =
    orders.length === 0 && garments.length === 0 && customers.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Results for “${query}”`}
        description={`${garments.length} garments · ${orders.length} orders · ${customers.length} customers`}
      />

      {nothingFound ? (
        <EmptyState
          icon={SearchIcon}
          title="Nothing matched"
          description="Check the code and try again. Garment ids look like TR-1042 and order numbers like ORD10245."
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Jump to a category</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {GARMENT_CATEGORIES.map((meta) => (
            <Link
              key={meta.value}
              href={`/tracking/${categorySlug(meta.value)}`}
              className="rounded-full border border-border px-3 py-1.5 text-sm transition hover:bg-accent"
            >
              <span aria-hidden>{meta.emoji}</span> {meta.label}
            </Link>
          ))}
        </CardContent>
      </Card>

      {customers.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Customers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {customers.map((customer) => (
              <Link
                key={customer.id}
                href={`/customers/${customer.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <span className="font-semibold">{customer.name}</span>
                  <span className="ml-2 font-mono text-muted-foreground">
                    {customer.phone} · {customer.code}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {customer.orderCount} order{customer.orderCount === 1 ? "" : "s"}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {garments.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Garments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {garments.map((garment) => (
              <Link
                key={garment.id}
                href={`/garments/${garment.garmentCode}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <span className="font-mono font-semibold">{garment.garmentCode}</span>
                  <span className="ml-2 text-muted-foreground">
                    {garment.garmentType.name} · {garment.order.orderNumber} ·{" "}
                    {garment.order.customerName}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge
                    status={garment.status}
                    label={GARMENT_STATUS_LABELS[garment.status]}
                  />
                  <span className="text-xs text-muted-foreground">
                    {STAGE_LABELS[garment.currentStage]}
                  </span>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {orders.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Orders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {orders.map((order) => (
              <Link
                key={order.id}
                href={`/orders/${order.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-sm hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <span className="font-mono font-semibold">{order.orderNumber}</span>
                  <span className="ml-2 text-muted-foreground">
                    {order.customerName} · {order.customerPhone} ·{" "}
                    {formatDateTime(order.placedAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={order.status} dot />
                  {canSeeMoney ? (
                    <span className="numeric text-xs">
                      {formatCurrency(order.totalAmount)}
                    </span>
                  ) : null}
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
