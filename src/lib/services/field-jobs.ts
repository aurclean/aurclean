import "server-only";

import { prisma } from "@/lib/prisma";
import { requireFirmId, type SessionUser } from "@/lib/session";

/**
 * Everything a Field Manager can see. Every query is pinned to (a) the
 * authenticated user's own firm and (b) jobs assigned to THIS user's driver
 * profile — there is no parameter that widens either. The select lists carry
 * only what is needed to do the job (contact, address, schedule, status): no
 * prices, payments or invoice data.
 */
export async function ensureDriverProfile(user: SessionUser): Promise<string> {
  const existing = await prisma.driver.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (existing) return existing.id;
  return (await prisma.driver.create({ data: { userId: user.id }, select: { id: true } })).id;
}

const ACTIVE_PICKUP = ["REQUESTED", "DRIVER_ASSIGNED", "DRIVER_ACCEPTED", "PICKED_UP"] as const;
const ACTIVE_DELIVERY = ["PENDING", "DRIVER_ASSIGNED", "OUT_FOR_DELIVERY", "RESCHEDULED"] as const;

export async function getFieldJobs(user: SessionUser, opts: { history?: boolean; todayOnly?: boolean } = {}) {
  const firmId = requireFirmId(user);
  const driverId = await ensureDriverProfile(user);

  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const when = opts.todayOnly ? { scheduledAt: { lte: end } } : {};

  const [pickups, deliveries] = await Promise.all([
    prisma.pickup.findMany({
      where: {
        firmId,
        driverId,
        ...when,
        status: opts.history ? { notIn: [...ACTIVE_PICKUP] } : { in: [...ACTIVE_PICKUP] },
      },
      orderBy: { scheduledAt: opts.history ? "desc" : "asc" },
      take: opts.history ? 50 : 100,
      select: {
        id: true, pickupNumber: true, status: true, scheduledAt: true, contactName: true, contactPhone: true,
        addressLine: true, landmark: true, notes: true, failureReason: true, order: { select: { orderNumber: true } },
      },
    }),
    prisma.delivery.findMany({
      where: {
        firmId,
        driverId,
        ...when,
        status: opts.history ? { notIn: [...ACTIVE_DELIVERY] } : { in: [...ACTIVE_DELIVERY] },
      },
      orderBy: { scheduledAt: opts.history ? "desc" : "asc" },
      take: opts.history ? 50 : 100,
      select: {
        id: true, deliveryNumber: true, status: true, scheduledAt: true, contactName: true, contactPhone: true,
        addressLine: true, landmark: true, notes: true, failureReason: true, order: { select: { orderNumber: true } },
      },
    }),
  ]);

  return { pickups, deliveries };
}
