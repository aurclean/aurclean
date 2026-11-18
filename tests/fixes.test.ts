import assert from "node:assert/strict";
import test from "node:test";

import { generateServiceCode } from "@/lib/service-code";
import { computeTotals, resolveDiscountAmount, serializeDecimals } from "@/lib/money";
import { Prisma } from "@/generated/prisma/client";
import {
  formatBranchAddress,
  formatCompanyHeaderTitle,
} from "@/lib/pdf/header-format";
import { serviceSchema } from "@/lib/validations/settings";
import { createOrderSchema } from "@/lib/validations/order";

test("generateServiceCode derives clean uppercase codes within 20 chars", () => {
  assert.equal(generateServiceCode("Dry Clean"), "DRY-CLEAN");
  assert.equal(generateServiceCode("Wash & Fold"), "WASH-FOLD");
  assert.equal(generateServiceCode("Steam Press (Express) Premium"), "STEAM-PRESS-EXPRESS");
  assert.equal(generateServiceCode("Steam Press (Express) Premium", "2").length <= 20, true);
  assert.equal(generateServiceCode("Steam Press (Express) Premium", "2"), "STEAM-PRESS-EXPRES-2");
  assert.equal(generateServiceCode("   "), "SVC");
  assert.equal(generateServiceCode("A"), "A-SVC");
});

test("serviceSchema allows blank code (auto-generated) and optional basePrice", () => {
  const parsed = serviceSchema.parse({
    name: "Dry Clean",
    stages: ["SORTING", "WASHING"],
  });
  assert.equal(parsed.code, "");
  assert.equal(parsed.basePrice, 0);

  const withCode = serviceSchema.parse({
    code: "dry-clean",
    name: "Dry Clean",
    basePrice: 120,
    stages: ["WASHING"],
  });
  assert.equal(withCode.code, "DRY-CLEAN");
  assert.equal(withCode.basePrice, 120);
});

test("resolveDiscountAmount and computeTotals support both AMOUNT and PERCENT", () => {
  assert.equal(resolveDiscountAmount(500, "AMOUNT", 50), 50);
  assert.equal(resolveDiscountAmount(500, "AMOUNT", 999), 500);
  assert.equal(resolveDiscountAmount(500, "PERCENT", 10), 50);
  assert.equal(resolveDiscountAmount(333, "PERCENT", 15), 49.95);
  assert.equal(resolveDiscountAmount(500, "PERCENT", 150), 500);

  const pctTotals = computeTotals({
    subtotal: 200,
    discountType: "PERCENT",
    discountValue: 10,
    gstRate: 18,
  });
  assert.equal(pctTotals.discountAmount, 20);
  assert.equal(pctTotals.taxableAmount, 180);
  assert.equal(pctTotals.gstAmount, 32.4);
  assert.equal(pctTotals.totalAmount, 212.4);

  const amtTotals = computeTotals({
    subtotal: 200,
    discountAmount: 25,
    gstRate: 18,
  });
  assert.equal(amtTotals.discountAmount, 25);
  assert.equal(amtTotals.taxableAmount, 175);
  assert.equal(amtTotals.gstAmount, 31.5);
  assert.equal(amtTotals.totalAmount, 206.5);
});

test("createOrderSchema validates percentage discount bounds", () => {
  const baseOrder = {
    branchId: "ckz1234567890123456789012",
    customerName: "Iqbal",
    customerPhone: "9986116089",
    expectedDeliveryAt: "2026-11-20",
    pickupScheduledAt: null,
    items: [
      {
        serviceId: "ckz1234567890123456789013",
        garmentTypeId: "ckz1234567890123456789014",
        quantity: 2,
      },
    ],
  };

  const validPct = createOrderSchema.safeParse({
    ...baseOrder,
    discountType: "PERCENT",
    discountValue: 15,
  });
  assert.equal(validPct.success, true, validPct.success ? "" : JSON.stringify(validPct.error.issues));

  const invalidPct = createOrderSchema.safeParse({
    ...baseOrder,
    discountType: "PERCENT",
    discountValue: 120,
  });
  assert.equal(invalidPct.success, false);
});

test("formatCompanyHeaderTitle and formatBranchAddress deduplicate repeated names", () => {
  assert.equal(
    formatCompanyHeaderTitle(
      "Aurclean - The Organic Laundry, DKT",
      "Aurclean - The Organic Laundry, DKT",
    ),
    "Aurclean - The Organic Laundry, DKT",
  );
  assert.equal(
    formatCompanyHeaderTitle(
      "Aurclean - The Organic Laundry",
      "Aurclean - The Organic Laundry, DKT",
    ),
    "Aurclean - The Organic Laundry, DKT",
  );
  assert.equal(
    formatCompanyHeaderTitle("Aurclean", "Deralakatte"),
    "Aurclean - Deralakatte",
  );
  assert.equal(
    formatBranchAddress([
      "Father Mullers Building, Deralakatte",
      "Deralakatte",
      "Karnataka",
      null,
    ]),
    "Father Mullers Building, Deralakatte, Karnataka",
  );
});

test("serializeDecimals converts nested Prisma.Decimal instances to plain numbers", () => {
  const now = new Date();
  const payload = {
    id: "ch1",
    createdAt: now,
    grandTotal: new Prisma.Decimal("508.70"),
    items: [{ unitPrice: new Prisma.Decimal("132.00"), amount: new Prisma.Decimal("264.00") }],
    order: { totalAmount: new Prisma.Decimal("508.70"), payments: [{ amount: new Prisma.Decimal("254.35") }] },
  };
  const serialized = serializeDecimals(payload);
  assert.equal(serialized.grandTotal, 508.7);
  assert.equal(serialized.items[0].unitPrice, 132);
  assert.equal(serialized.items[0].amount, 264);
  assert.equal(serialized.order.totalAmount, 508.7);
  assert.equal(serialized.order.payments[0].amount, 254.35);
  assert.equal(serialized.createdAt, now);
});
