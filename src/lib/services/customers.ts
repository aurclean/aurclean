import "server-only";
import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/action-result";
import { num, round2 } from "@/lib/money";
import { nextCustomerCode } from "@/lib/sequence";
import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

/** Phone numbers are the identity at the counter, so normalise before matching. */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export interface CustomerDetails {
  name: string;
  phone: string;
  email?: string | null;
  addressLine?: string | null;
  city?: string | null;
  pincode?: string | null;
  landmark?: string | null;
  notes?: string | null;
}

/**
 * Finds the customer behind a counter transaction, creating the record the
 * first time that phone number is seen at the branch. Details supplied on a
 * later order refresh the directory entry without touching earlier orders,
 * which keep their own snapshot for billing.
 */
export async function upsertCustomer(
  tx: Db,
  params: {
    branchId: string;
    firmId: string;
    details: CustomerDetails;
    createdById?: string | null;
  },
): Promise<{ id: string; code: string; isNew: boolean }> {
  const phone = normalisePhone(params.details.phone);
  const existing = await tx.customer.findFirst({
    where: { branchId: params.branchId, phone },
    select: { id: true, code: true },
  });

  const contact = {
    name: params.details.name.trim(),
    email: params.details.email?.trim() || null,
    addressLine: params.details.addressLine?.trim() || null,
    city: params.details.city?.trim() || null,
    pincode: params.details.pincode?.trim() || null,
    landmark: params.details.landmark?.trim() || null,
  };

  if (existing) {
    const updated = await tx.customer.update({
      where: { id: existing.id },
      data: {
        name: contact.name,
        // Keep whatever we already hold when the new order left a field blank.
        email: contact.email ?? undefined,
        addressLine: contact.addressLine ?? undefined,
        city: contact.city ?? undefined,
        pincode: contact.pincode ?? undefined,
        landmark: contact.landmark ?? undefined,
        notes: params.details.notes?.trim() || undefined,
        isActive: true,
      },
      select: { id: true, code: true },
    });
    return { ...updated, isNew: false };
  }

  const created = await tx.customer.create({
    data: {
      code: await nextCustomerCode(tx),
      branchId: params.branchId,
      firmId: params.firmId,
      phone,
      ...contact,
      notes: params.details.notes?.trim() || null,
      createdById: params.createdById ?? null,
    },
    select: { id: true, code: true },
  });

  return { ...created, isNew: true };
}

/**
 * Re-derives the lifetime figures shown on a customer profile. Like the order
 * money columns these are recomputed rather than incremented, so a corrected
 * or cancelled order cannot leave the totals drifting.
 */
export async function recalcCustomerRollup(tx: Db, customerId: string): Promise<void> {
  const [counted, money, latest] = await Promise.all([
    tx.order.count({ where: { customerId, status: { not: "CANCELLED" } } }),
    tx.order.aggregate({
      where: { customerId, status: { not: "CANCELLED" } },
      _sum: { paidAmount: true, outstandingAmount: true },
    }),
    tx.order.findFirst({
      where: { customerId },
      orderBy: { placedAt: "desc" },
      select: { placedAt: true },
    }),
  ]);

  await tx.customer.update({
    where: { id: customerId },
    data: {
      orderCount: counted,
      totalSpent: round2(num(money._sum.paidAmount)),
      outstandingAmount: round2(num(money._sum.outstandingAmount)),
      lastOrderAt: latest?.placedAt ?? null,
    },
  });
}

export interface CustomerListRow {
  id: string;
  code: string;
  name: string;
  phone: string;
  email: string | null;
  city: string | null;
  branchName: string;
  orderCount: number;
  totalSpent: number;
  outstandingAmount: number;
  lastOrderAt: Date | null;
  isRepeat: boolean;
}

export type CustomerSort = "recent" | "name" | "spend" | "outstanding" | "orders";

/**
 * Directory search. A query matches a name, a phone number in any punctuation,
 * the customer code, or an order number the customer has placed — the counter
 * often has nothing but the tag in hand.
 */
export async function listCustomers(params: {
  firmId: string;
  branchIds: string[] | null;
  search?: string;
  sort?: CustomerSort;
  direction?: "asc" | "desc";
  onlyOutstanding?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<{ rows: CustomerListRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, params.pageSize ?? 20));
  const search = params.search?.trim();

  const where: Prisma.CustomerWhereInput = {
    firmId: params.firmId,
    ...(params.branchIds ? { branchId: { in: params.branchIds } } : {}),
    ...(params.onlyOutstanding ? { outstandingAmount: { gt: 0 } } : {}),
  };

  if (search) {
    const digits = search.replace(/\D/g, "");
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { code: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      ...(digits ? [{ phone: { contains: digits } }] : []),
      { orders: { some: { orderNumber: { contains: search, mode: "insensitive" } } } },
    ];
  }

  // A column header supplies its own direction; the sort dropdown keeps the
  // sensible default for each field (biggest spend first, newest order first).
  const fallback: Record<CustomerSort, "asc" | "desc"> = {
    name: "asc",
    spend: "desc",
    outstanding: "desc",
    recent: "desc",
    orders: "desc",
  };
  const sort = params.sort ?? "recent";
  const direction = params.direction ?? fallback[sort];

  const orderBy: Prisma.CustomerOrderByWithRelationInput =
    sort === "name"
      ? { name: direction }
      : sort === "spend"
        ? { totalSpent: direction }
        : sort === "outstanding"
          ? { outstandingAmount: direction }
          : sort === "orders"
            ? { orderCount: direction }
            : { lastOrderAt: direction };

  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: [orderBy, { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { branch: { select: { name: true } } },
    }),
    prisma.customer.count({ where }),
  ]);

  return {
    total,
    page,
    pageSize,
    rows: rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      phone: row.phone,
      email: row.email,
      city: row.city,
      branchName: row.branch.name,
      orderCount: row.orderCount,
      totalSpent: num(row.totalSpent),
      outstandingAmount: num(row.outstandingAmount),
      lastOrderAt: row.lastOrderAt,
      isRepeat: row.orderCount > 1,
    })),
  };
}

export interface CustomerProfile {
  id: string;
  code: string;
  firmId: string;
  branchId: string;
  branchName: string;
  name: string;
  phone: string;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  pincode: string | null;
  landmark: string | null;
  notes: string | null;
  isActive: boolean;
  isRepeat: boolean;
  orderCount: number;
  totalSpent: number;
  outstandingAmount: number;
  lastOrderAt: Date | null;
  createdAt: Date;
  averageOrderValue: number;
  activeOrders: number;
  orders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    paymentStatus: string;
    placedAt: Date;
    expectedDeliveryAt: Date;
    totalPieces: number;
    totalAmount: number;
    paidAmount: number;
    outstandingAmount: number;
  }>;
  deliveryChallans: Array<any>;
  topServices: Array<{ name: string; pieces: number }>;
}

export async function getCustomerProfile(id: string, firmId: string): Promise<CustomerProfile> {
  const normPhone = normalisePhone(id);
  const customer = await prisma.customer.findFirst({
    where: {
      firmId,
      OR: [
        { id },
        { code: id },
        ...(normPhone ? [{ phone: normPhone }] : []),
      ],
    },
    include: {
      branch: { select: { name: true } },
      orders: {
        orderBy: { placedAt: "desc" },
        take: 50,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          placedAt: true,
          expectedDeliveryAt: true,
          totalPieces: true,
          totalAmount: true,
          paidAmount: true,
          outstandingAmount: true,
        },
      },
      deliveryChallans: {
        orderBy: { challanDate: "desc" },
        take: 50,
        include: {
          order: { select: { id: true, orderNumber: true } },
        },
      },
    },
  });

  if (!customer) throw new NotFoundError("Customer not found");

  const serviceRows = await prisma.orderItem.groupBy({
    by: ["serviceId"],
    where: { order: { customerId: id } },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: 5,
  });

  const services = await prisma.service.findMany({
    where: { id: { in: serviceRows.map((row) => row.serviceId) } },
    select: { id: true, name: true },
  });
  const serviceName = new Map(services.map((s) => [s.id, s.name]));

  const closed = new Set(["DELIVERED", "CANCELLED", "REFUNDED"]);
  const totalSpent = num(customer.totalSpent);

  return {
    id: customer.id,
    code: customer.code,
    firmId: customer.firmId,
    branchId: customer.branchId,
    branchName: customer.branch.name,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    addressLine: customer.addressLine,
    city: customer.city,
    pincode: customer.pincode,
    landmark: customer.landmark,
    notes: customer.notes,
    isActive: customer.isActive,
    isRepeat: customer.orderCount > 1,
    orderCount: customer.orderCount,
    totalSpent,
    outstandingAmount: num(customer.outstandingAmount),
    lastOrderAt: customer.lastOrderAt,
    createdAt: customer.createdAt,
    averageOrderValue: customer.orderCount > 0 ? round2(totalSpent / customer.orderCount) : 0,
    activeOrders: customer.orders.filter((order) => !closed.has(order.status)).length,
    orders: customer.orders.map((order) => ({
      ...order,
      totalAmount: num(order.totalAmount),
      paidAmount: num(order.paidAmount),
      outstandingAmount: num(order.outstandingAmount),
    })),
    deliveryChallans: customer.deliveryChallans.map((dc) => ({
      ...dc,
      grandTotal: num(dc.grandTotal),
      paidAmount: num(dc.paidAmount),
      balanceAmount: num(dc.balanceAmount),
    })),
    topServices: serviceRows.map((row) => ({
      name: serviceName.get(row.serviceId) ?? "Service",
      pieces: row._sum.quantity ?? 0,
    })),
  };
}

/** Type-ahead used by the order form so the counter never retypes a regular. */
export async function searchCustomersForOrder(params: {
  firmId: string;
  branchIds: string[] | null;
  query: string;
  limit?: number;
}): Promise<
  Array<{
    id: string;
    name: string;
    phone: string;
    email: string | null;
    addressLine: string | null;
    city: string | null;
    pincode: string | null;
    landmark: string | null;
    orderCount: number;
    outstandingAmount: number;
  }>
> {
  const query = params.query.trim();
  if (query.length < 2) return [];
  const digits = query.replace(/\D/g, "");

  const rows = await prisma.customer.findMany({
    where: {
      firmId: params.firmId,
      isActive: true,
      ...(params.branchIds ? { branchId: { in: params.branchIds } } : {}),
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        ...(digits ? [{ phone: { contains: digits } }] : []),
      ],
    },
    orderBy: [{ orderCount: "desc" }, { name: "asc" }],
    take: params.limit ?? 8,
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      addressLine: true,
      city: true,
      pincode: true,
      landmark: true,
      orderCount: true,
      outstandingAmount: true,
    },
  });

  return rows.map((row) => ({ ...row, outstandingAmount: num(row.outstandingAmount) }));
}
