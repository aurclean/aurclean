import "server-only";
import { prisma } from "@/lib/prisma";
import { num, round2 } from "@/lib/money";
import type { PricingMode } from "@/generated/prisma/enums";

export interface PriceRequest {
  serviceId: string;
  garmentTypeId: string;
  quantity: number;
  weightKg: number;
  b2bAccountId?: string | null;
}

export interface ResolvedPrice {
  pricingMode: PricingMode;
  unitPrice: number;
  lineTotal: number;
  source: "B2B_RATE_CARD" | "SERVICE_RATE" | "SERVICE_BASE";
}

/**
 * Price resolution order:
 *   1. an active B2B rate card on the customer's contract
 *   2. the service × garment-type rate
 *   3. the service's base price
 * Weight-based services bill on kilograms, everything else on pieces.
 */
export async function resolvePrice(input: PriceRequest): Promise<ResolvedPrice> {
  const service = await prisma.service.findUnique({
    where: { id: input.serviceId },
    select: { id: true, pricingMode: true, basePrice: true, isActive: true },
  });

  if (!service) throw new Error("Service not found");

  const quantityFor = (mode: PricingMode) =>
    mode === "PER_KG" ? input.weightKg : mode === "FLAT" ? 1 : input.quantity;

  if (input.b2bAccountId) {
    const now = new Date();
    const rateCard = await prisma.b2BRateCard.findFirst({
      where: {
        serviceId: input.serviceId,
        contract: {
          accountId: input.b2bAccountId,
          status: "ACTIVE",
          startDate: { lte: now },
          OR: [{ endDate: null }, { endDate: { gte: now } }],
        },
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        AND: [
          {
            OR: [
              { garmentTypeId: input.garmentTypeId },
              { garmentTypeId: null },
            ],
          },
        ],
      },
      // A garment-specific card beats a service-wide one.
      orderBy: [{ garmentTypeId: "desc" }, { effectiveFrom: "desc" }],
    });

    if (rateCard) {
      const mode = rateCard.pricingMode;
      const unitPrice = num(rateCard.rate);
      return {
        pricingMode: mode,
        unitPrice,
        lineTotal: round2(unitPrice * quantityFor(mode)),
        source: "B2B_RATE_CARD",
      };
    }
  }

  const serviceRate = await prisma.serviceRate.findUnique({
    where: {
      serviceId_garmentTypeId: {
        serviceId: input.serviceId,
        garmentTypeId: input.garmentTypeId,
      },
    },
  });

  const mode = service.pricingMode;

  if (serviceRate) {
    const unitPrice = num(serviceRate.price);
    return {
      pricingMode: mode,
      unitPrice,
      lineTotal: round2(unitPrice * quantityFor(mode)),
      source: "SERVICE_RATE",
    };
  }

  const unitPrice = num(service.basePrice);
  return {
    pricingMode: mode,
    unitPrice,
    lineTotal: round2(unitPrice * quantityFor(mode)),
    source: "SERVICE_BASE",
  };
}

/** Batch price resolution for a whole order form. */
export async function resolvePrices(
  items: PriceRequest[],
): Promise<ResolvedPrice[]> {
  return Promise.all(items.map(resolvePrice));
}
