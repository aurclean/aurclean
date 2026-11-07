import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { AuthorizationError, getCurrentUser, requireFirmId } from "@/lib/session";
import { isGlobalRole } from "@/lib/rbac";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";

/**
 * Resolves human-facing codes (ORD10245, G1001) into record ids so forms can
 * accept what staff actually read off a tag. Branch-scoped like every other read.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let firmId: string;
  try {
    firmId = requireFirmId(user);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  const limit = rateLimit(
    `lookup:${user.id}`,
    RATE_LIMITS.SCAN.limit,
    RATE_LIMITS.SCAN.windowMs,
  );
  if (!limit.success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const orderNumber = searchParams.get("order")?.trim().toUpperCase();
  const garmentCode = searchParams.get("garment")?.trim().toUpperCase();

  const branchFilter =
    isGlobalRole(user.role) || !user.branchId ? {} : { branchId: user.branchId };

  const [order, garment] = await Promise.all([
    orderNumber
      ? prisma.order.findFirst({
          where: { orderNumber, firmId, ...branchFilter },
          select: { id: true, orderNumber: true, customerName: true },
        })
      : null,
    garmentCode
      ? prisma.garment.findFirst({
          where: { garmentCode, firmId, ...branchFilter },
          select: { id: true, garmentCode: true, orderId: true },
        })
      : null,
  ]);

  return NextResponse.json({
    orderId: order?.id ?? garment?.orderId ?? null,
    orderNumber: order?.orderNumber ?? null,
    customerName: order?.customerName ?? null,
    garmentId: garment?.id ?? null,
    garmentCode: garment?.garmentCode ?? null,
  });
}
