import Link from "next/link";
import { PackageCheck, Truck } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { RowActions } from "@/components/shared/row-actions";
import { CancelDeliveryButton } from "@/app/(app)/delivery/delivery-row-actions";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  AssignDriverControl,
  CompleteDeliveryDialog,
  DispatchControl,
  PickupStatusControl,
  ScheduleDeliveryDialog,
  type DriverOption,
} from "@/app/(app)/delivery/delivery-controls";
import { prisma } from "@/lib/prisma";
import { formatCurrency, num } from "@/lib/money";
import { formatDateTime, todayRange } from "@/lib/dates";
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

export const metadata = { title: "Pickup & Delivery" };

interface PickupRow {
  id: string;
  pickupNumber: string;
  orderId: string;
  orderNumber: string;
  contactName: string;
  contactPhone: string;
  addressLine: string;
  scheduledAt: Date;
  status: string;
  driverId: string | null;
  driverName: string | null;
}

interface DeliveryRow {
  id: string;
  deliveryNumber: string;
  orderId: string;
  orderNumber: string;
  contactName: string;
  contactPhone: string;
  addressLine: string;
  scheduledAt: Date;
  status: string;
  driverId: string | null;
  driverName: string | null;
  amountToCollect: number;
  attemptCount: number;
}

export default async function DeliveryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requirePermission(PERMISSIONS.DELIVERY_VIEW);

  const branchId = scopedBranchId(user, params);
  const firmId = requireFirmId(user);
  const tab = param(params, "tab") ?? "deliveries";
  const status = param(params, "status");
  const search = param(params, "q");
  const today = todayRange();
  const branchWhere = branchId ? { branchId } : {};

  const pickupWhere: Prisma.PickupWhereInput = {
    branch: { firmId },
    ...branchWhere,
    ...(status && status !== "all" ? { status: status as never } : {}),
    ...(search
      ? {
          OR: [
            { pickupNumber: { contains: search, mode: "insensitive" } },
            { contactName: { contains: search, mode: "insensitive" } },
            { contactPhone: { contains: search } },
            { order: { orderNumber: { contains: search.toUpperCase() } } },
          ],
        }
      : {}),
  };

  const deliveryWhere: Prisma.DeliveryWhereInput = {
    firmId,
    ...branchWhere,
    ...(status && status !== "all" ? { status: status as never } : {}),
    ...(search
      ? {
          OR: [
            { deliveryNumber: { contains: search, mode: "insensitive" } },
            { contactName: { contains: search, mode: "insensitive" } },
            { contactPhone: { contains: search } },
            { order: { orderNumber: { contains: search.toUpperCase() } } },
          ],
        }
      : {}),
  };

  const [
    pickups,
    deliveries,
    drivers,
    readyOrders,
    todayPickups,
    todayDeliveries,
    pendingHandover,
    toCollect,
    branches,
  ] = await Promise.all([
    prisma.pickup.findMany({
      where: pickupWhere,
      orderBy: { scheduledAt: "asc" },
      take: 100,
      include: {
        order: { select: { id: true, orderNumber: true } },
        driver: { include: { user: { select: { name: true } } } },
      },
    }),
    prisma.delivery.findMany({
      where: deliveryWhere,
      orderBy: { scheduledAt: "asc" },
      take: 100,
      include: {
        order: { select: { id: true, orderNumber: true } },
        driver: { include: { user: { select: { name: true } } } },
      },
    }),
    prisma.driver.findMany({
      where: {
        user: {
          firmId,
          status: "ACTIVE",
          ...(branchId ? { branchId } : {}),
        },
      },
      include: { user: { select: { name: true } } },
    }),
    prisma.order.findMany({
      where: {
        firmId,
        ...branchWhere,
        status: "READY",
        deliveries: { none: { status: { in: ["PENDING", "DRIVER_ASSIGNED", "OUT_FOR_DELIVERY"] } } },
      },
      orderBy: { readyAt: "asc" },
      take: 100,
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        customerPhone: true,
        addressLine: true,
        outstandingAmount: true,
      },
    }),
    prisma.pickup.count({
      where: { branch: { firmId }, ...branchWhere, scheduledAt: { gte: today.from, lte: today.to } },
    }),
    prisma.delivery.count({
      where: { firmId, ...branchWhere, scheduledAt: { gte: today.from, lte: today.to } },
    }),
    prisma.order.count({ where: { firmId, ...branchWhere, status: "READY" } }),
    prisma.delivery.aggregate({
      where: {
        firmId,
        ...branchWhere,
        status: { in: ["PENDING", "DRIVER_ASSIGNED", "OUT_FOR_DELIVERY"] },
      },
      _sum: { amountToCollect: true },
    }),
    branchOptions(user),
  ]);

  const driverOptions: DriverOption[] = drivers.map((driver) => ({
    id: driver.id,
    name: driver.user.name,
    vehicleNumber: driver.vehicleNumber,
  }));

  const canManage = hasPermission(user, PERMISSIONS.DELIVERY_MANAGE);
  const canAssign = hasPermission(user, PERMISSIONS.DELIVERY_ASSIGN_DRIVER);
  const canCollect = hasPermission(user, PERMISSIONS.DELIVERY_COLLECT_PAYMENT);

  const pickupRows: PickupRow[] = pickups.map((pickup) => ({
    id: pickup.id,
    pickupNumber: pickup.pickupNumber,
    orderId: pickup.order.id,
    orderNumber: pickup.order.orderNumber,
    contactName: pickup.contactName,
    contactPhone: pickup.contactPhone,
    addressLine: pickup.addressLine,
    scheduledAt: pickup.scheduledAt,
    status: pickup.status,
    driverId: pickup.driverId,
    driverName: pickup.driver?.user.name ?? null,
  }));

  const deliveryRows: DeliveryRow[] = deliveries.map((delivery) => ({
    id: delivery.id,
    deliveryNumber: delivery.deliveryNumber,
    orderId: delivery.order.id,
    orderNumber: delivery.order.orderNumber,
    contactName: delivery.contactName,
    contactPhone: delivery.contactPhone,
    addressLine: delivery.addressLine,
    scheduledAt: delivery.scheduledAt,
    status: delivery.status,
    driverId: delivery.driverId,
    driverName: delivery.driver?.user.name ?? null,
    amountToCollect: num(delivery.amountToCollect),
    attemptCount: delivery.attemptCount,
  }));

  const pickupColumns: Column<PickupRow>[] = [
    {
      key: "number",
      header: "Pickup",
      cell: (row) => (
        <div className="space-y-0.5">
          <span className="font-mono text-sm font-semibold">{row.pickupNumber}</span>
          <Link
            href={`/orders/${row.orderId}`}
            className="block font-mono text-xs text-primary hover:underline"
          >
            {row.orderNumber}
          </Link>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{row.contactName}</p>
          <p className="font-mono text-xs text-muted-foreground">{row.contactPhone}</p>
        </div>
      ),
    },
    {
      key: "address",
      header: "Address",
      hideOnMobile: true,
      cell: (row) => (
        <p className="max-w-56 truncate text-sm text-muted-foreground">{row.addressLine}</p>
      ),
    },
    {
      key: "when",
      header: "Scheduled",
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{formatDateTime(row.scheduledAt)}</span>
      ),
    },
    { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} dot /> },
    {
      key: "driver",
      header: "Driver",
      cell: (row) =>
        canAssign ? (
          <AssignDriverControl
            jobId={row.id}
            jobType="PICKUP"
            drivers={driverOptions}
            currentDriverId={row.driverId}
          />
        ) : (
          <span className="text-sm text-muted-foreground">{row.driverName ?? "—"}</span>
        ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          {canManage ? <PickupStatusControl pickupId={row.id} status={row.status} /> : null}
          {canManage && !["RECEIVED_AT_LAUNDRY", "CANCELLED"].includes(row.status) ? (
            <CancelDeliveryButton
              compact
              pickupId={row.id}
              deliveryNumber={row.pickupNumber}
            />
          ) : null}
        </div>
      ),
    },
  ];

  const deliveryColumns: Column<DeliveryRow>[] = [
    {
      key: "number",
      header: "Delivery",
      cell: (row) => (
        <div className="space-y-0.5">
          <span className="font-mono text-sm font-semibold">{row.deliveryNumber}</span>
          <Link
            href={`/orders/${row.orderId}`}
            className="block font-mono text-xs text-primary hover:underline"
          >
            {row.orderNumber}
          </Link>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{row.contactName}</p>
          <p className="font-mono text-xs text-muted-foreground">{row.contactPhone}</p>
        </div>
      ),
    },
    {
      key: "address",
      header: "Address",
      hideOnMobile: true,
      cell: (row) => (
        <p className="max-w-56 truncate text-sm text-muted-foreground">{row.addressLine}</p>
      ),
    },
    {
      key: "when",
      header: "Scheduled",
      cell: (row) => (
        <div>
          <span className="text-sm text-muted-foreground">
            {formatDateTime(row.scheduledAt)}
          </span>
          {row.attemptCount > 0 ? (
            <p className="text-xs text-destructive">
              {row.attemptCount} attempt{row.attemptCount > 1 ? "s" : ""}
            </p>
          ) : null}
        </div>
      ),
    },
    { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} dot /> },
    {
      key: "collect",
      header: "To collect",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <span
          className={`text-sm numeric ${row.amountToCollect > 0 ? "font-semibold" : "text-muted-foreground"}`}
        >
          {formatCurrency(row.amountToCollect)}
        </span>
      ),
    },
    {
      key: "driver",
      header: "Driver",
      cell: (row) =>
        canAssign ? (
          <AssignDriverControl
            jobId={row.id}
            jobType="DELIVERY"
            drivers={driverOptions}
            currentDriverId={row.driverId}
          />
        ) : (
          <span className="text-sm text-muted-foreground">{row.driverName ?? "—"}</span>
        ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          <RowActions viewHref={`/delivery/${row.id}`} />
          {!canManage || ["DELIVERED", "CANCELLED"].includes(row.status) ? null : (
            <>
              {row.status === "DRIVER_ASSIGNED" ? (
                <DispatchControl deliveryId={row.id} />
              ) : null}
              {row.status === "OUT_FOR_DELIVERY" ? (
                <CompleteDeliveryDialog
                  deliveryId={row.id}
                  deliveryNumber={row.deliveryNumber}
                  amountToCollect={row.amountToCollect}
                  canCollect={canCollect}
                />
              ) : null}
              <CancelDeliveryButton
                compact
                deliveryId={row.id}
                deliveryNumber={row.deliveryNumber}
              />
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <LiveRefresh intervalMs={30000} />
      <PageHeader
        title="Pickup & delivery"
        description="Collection runs, dispatch and door-step payment in one place."
        actions={
          canManage ? (
            <ScheduleDeliveryDialog
              orders={readyOrders.map((order) => ({
                ...order,
                outstandingAmount: num(order.outstandingAmount),
              }))}
              drivers={driverOptions}
            />
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pickups today" value={todayPickups} icon={Truck} />
        <StatCard label="Deliveries today" value={todayDeliveries} icon={Truck} tone="info" />
        <StatCard
          label="Ready for handover"
          value={pendingHandover}
          icon={PackageCheck}
          tone="success"
        />
        <StatCard
          label="Cash on the road"
          value={formatCurrency(toCollect._sum.amountToCollect ?? 0)}
          tone="warning"
        />
      </div>

      <Tabs value={tab}>
        <TabsList>
          <TabsTrigger value="deliveries" asChild>
            <Link href="/delivery?tab=deliveries">Deliveries</Link>
          </TabsTrigger>
          <TabsTrigger value="pickups" asChild>
            <Link href="/delivery?tab=pickups">Pickups</Link>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="deliveries" className="space-y-4">
          <FilterBar
            searchPlaceholder="Delivery number, order, customer…"
            filters={[
              {
                name: "status",
                label: "Status",
                options: enumOptions([
                  "PENDING",
                  "DRIVER_ASSIGNED",
                  "OUT_FOR_DELIVERY",
                  "DELIVERED",
                  "FAILED",
                  "RESCHEDULED",
                  "CANCELLED",
                ] as const),
              },
              ...(branches.length > 1
                ? [{ name: "branch", label: "Branch", options: branches }]
                : []),
            ]}
          />
          <DataTable
            columns={deliveryColumns}
            rows={deliveryRows}
            getRowKey={(row) => row.id}
            empty={
              <EmptyState
                icon={Truck}
                title="No deliveries"
                description="Schedule a delivery once an order is packed and ready."
              />
            }
          />
        </TabsContent>

        <TabsContent value="pickups" className="space-y-4">
          <FilterBar
            searchPlaceholder="Pickup number, order, customer…"
            filters={[
              {
                name: "status",
                label: "Status",
                options: enumOptions([
                  "REQUESTED",
                  "DRIVER_ASSIGNED",
                  "DRIVER_ACCEPTED",
                  "PICKED_UP",
                  "RECEIVED_AT_LAUNDRY",
                  "FAILED",
                  "CANCELLED",
                ] as const),
              },
              ...(branches.length > 1
                ? [{ name: "branch", label: "Branch", options: branches }]
                : []),
            ]}
          />
          <DataTable
            columns={pickupColumns}
            rows={pickupRows}
            getRowKey={(row) => row.id}
            empty={
              <EmptyState
                icon={Truck}
                title="No pickups"
                description="Pickups are created automatically when an order is booked for collection."
              />
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
