"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";
import { assertFirmAccess, authorize, requireFirmId } from "@/lib/session";
import {
  BusinessRuleError,
  NotFoundError,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { formatCurrency, num, round2, splitGst } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { nextContractNumber, nextInvoiceNumber, nextStatementNumber } from "@/lib/sequence";
import {
  b2bAccountSchema,
  contractSchema,
  rateCardSchema,
  scheduleSchema,
  statementSchema,
} from "@/lib/validations/b2b";

export async function saveB2BAccountAction(
  payload: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.B2B_MANAGE);
    const input = b2bAccountSchema.parse(payload);

    if (input.id) {
      const existing = await prisma.b2BAccount.findUnique({
        where: { id: input.id },
        select: { firmId: true },
      });
      if (!existing) throw new NotFoundError("Corporate account not found");
      assertFirmAccess(user, existing.firmId);
    }

    const data = {
      code: input.code,
      businessName: input.businessName,
      type: input.type,
      contactPerson: input.contactPerson ?? null,
      phone: input.phone,
      email: input.email ?? null,
      billingAddress: input.billingAddress ?? null,
      gstNumber: input.gstNumber ?? null,
      creditLimit: input.creditLimit,
      creditDays: input.creditDays,
      paymentTerms: input.paymentTerms ?? null,
      branchId: input.branchId ?? null,
      isActive: input.isActive,
    };

    const account = input.id
      ? await prisma.b2BAccount.update({ where: { id: input.id }, data })
      : await prisma.b2BAccount.create({ data: { ...data, firmId: requireFirmId(user) } });

    await recordAudit({
      userId: user.id,
      branchId: input.branchId ?? user.branchId,
      action: input.id ? "B2B_ACCOUNT_UPDATED" : "B2B_ACCOUNT_CREATED",
      entity: "B2BAccount",
      entityId: account.id,
      summary: `${account.code} — ${account.businessName}`,
    });

    revalidatePath("/b2b");
    return { id: account.id };
  });
}

export async function saveContractAction(
  payload: unknown,
): Promise<ActionResult<{ id: string; contractNumber: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.B2B_MANAGE);
    const input = contractSchema.parse(payload);

    const account = await prisma.b2BAccount.findUnique({
      where: { id: input.accountId },
      select: { id: true, businessName: true, firmId: true },
    });
    if (!account) throw new NotFoundError("Corporate account not found");
    assertFirmAccess(user, account.firmId);

    if (input.endDate && input.endDate < input.startDate) {
      throw new BusinessRuleError("The end date cannot be before the start date");
    }

    if (input.id) {
      const existingContract = await prisma.b2BContract.findUnique({
        where: { id: input.id },
        select: { accountId: true },
      });
      if (!existingContract || existingContract.accountId !== account.id) {
        throw new NotFoundError("Contract not found");
      }
    }

    const contract = input.id
      ? await prisma.b2BContract.update({
          where: { id: input.id },
          data: {
            startDate: input.startDate,
            endDate: input.endDate,
            billingCycle: input.billingCycle,
            minimumMonthlyValue: input.minimumMonthlyValue,
            status: input.status,
            terms: input.terms ?? null,
          },
        })
      : await prisma.b2BContract.create({
          data: {
            contractNumber: await nextContractNumber(),
            accountId: account.id,
            startDate: input.startDate,
            endDate: input.endDate,
            billingCycle: input.billingCycle,
            minimumMonthlyValue: input.minimumMonthlyValue,
            status: input.status,
            terms: input.terms ?? null,
          },
        });

    await recordAudit({
      userId: user.id,
      branchId: user.branchId,
      action: input.id ? "B2B_CONTRACT_UPDATED" : "B2B_CONTRACT_CREATED",
      entity: "B2BContract",
      entityId: contract.id,
      summary: `${contract.contractNumber} for ${account.businessName}`,
    });

    revalidatePath(`/b2b/${account.id}`);
    revalidatePath("/b2b");
    return { id: contract.id, contractNumber: contract.contractNumber };
  });
}

export async function saveRateCardAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.B2B_MANAGE);
    const input = rateCardSchema.parse(payload);

    const contract = await prisma.b2BContract.findUnique({
      where: { id: input.contractId },
      select: {
        id: true,
        contractNumber: true,
        accountId: true,
        account: { select: { firmId: true } },
      },
    });
    if (!contract) throw new NotFoundError("Contract not found");
    assertFirmAccess(user, contract.account.firmId);

    // Postgres treats NULLs as distinct in a unique index, so a service-wide
    // rate (garmentTypeId = null) cannot be upserted on the compound key.
    const existing = await prisma.b2BRateCard.findFirst({
      where: {
        contractId: contract.id,
        serviceId: input.serviceId,
        garmentTypeId: input.garmentTypeId ?? null,
      },
      select: { id: true },
    });

    const values = {
      pricingMode: input.pricingMode,
      rate: input.rate,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
    };

    if (existing) {
      await prisma.b2BRateCard.update({ where: { id: existing.id }, data: values });
    } else {
      await prisma.b2BRateCard.create({
        data: {
          contractId: contract.id,
          serviceId: input.serviceId,
          garmentTypeId: input.garmentTypeId ?? null,
          ...values,
        },
      });
    }

    await recordAudit({
      userId: user.id,
      branchId: user.branchId,
      action: "B2B_RATE_CARD_SAVED",
      entity: "B2BContract",
      entityId: contract.id,
      summary: `Rate ${formatCurrency(input.rate)} set on ${contract.contractNumber}`,
    });

    revalidatePath(`/b2b/${contract.accountId}`);
    return null;
  });
}

export async function deleteRateCardAction(rateCardId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.B2B_MANAGE);

    const rateCard = await prisma.b2BRateCard.findUnique({
      where: { id: rateCardId },
      select: {
        id: true,
        contract: {
          select: { accountId: true, contractNumber: true, account: { select: { firmId: true } } },
        },
      },
    });
    if (!rateCard) throw new NotFoundError("Rate card not found");
    assertFirmAccess(user, rateCard.contract.account.firmId);

    await prisma.b2BRateCard.delete({ where: { id: rateCardId } });

    await recordAudit({
      userId: user.id,
      branchId: user.branchId,
      action: "B2B_RATE_CARD_DELETED",
      entity: "B2BContract",
      summary: `Rate removed from ${rateCard.contract.contractNumber}`,
    });

    revalidatePath(`/b2b/${rateCard.contract.accountId}`);
    return null;
  });
}

export async function saveScheduleAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.B2B_MANAGE);
    const input = scheduleSchema.parse(payload);

    const scheduleAccount = await prisma.b2BAccount.findUnique({
      where: { id: input.accountId },
      select: { firmId: true },
    });
    if (!scheduleAccount) throw new NotFoundError("Corporate account not found");
    assertFirmAccess(user, scheduleAccount.firmId);

    await prisma.b2BSchedule.create({
      data: {
        accountId: input.accountId,
        type: input.type,
        dayOfWeek: input.dayOfWeek,
        timeSlot: input.timeSlot,
        notes: input.notes ?? null,
      },
    });

    await recordAudit({
      userId: user.id,
      branchId: user.branchId,
      action: "B2B_SCHEDULE_ADDED",
      entity: "B2BAccount",
      entityId: input.accountId,
      summary: `${input.type} scheduled for day ${input.dayOfWeek} at ${input.timeSlot}`,
    });

    revalidatePath(`/b2b/${input.accountId}`);
    return null;
  });
}

export async function deleteScheduleAction(
  scheduleId: string,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.B2B_MANAGE);
    const schedule = await prisma.b2BSchedule.findUnique({
      where: { id: scheduleId },
      select: { accountId: true, account: { select: { firmId: true } } },
    });
    if (!schedule) throw new NotFoundError("Schedule not found");
    assertFirmAccess(user, schedule.account.firmId);

    await prisma.b2BSchedule.delete({ where: { id: scheduleId } });
    revalidatePath(`/b2b/${schedule.accountId}`);
    return null;
  });
}

/**
 * Rolls every order in a period into one consolidated statement plus a single
 * B2B invoice, so corporate customers are billed once rather than per order.
 */
export async function generateStatementAction(
  payload: unknown,
): Promise<ActionResult<{ statementNumber: string; orderCount: number; total: number }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.B2B_BILLING);
    const input = statementSchema.parse(payload);

    if (input.periodEnd < input.periodStart) {
      throw new BusinessRuleError("The period end cannot be before its start");
    }

    const account = await prisma.b2BAccount.findUnique({
      where: { id: input.accountId },
      select: {
        id: true,
        firmId: true,
        businessName: true,
        billingAddress: true,
        gstNumber: true,
        phone: true,
        email: true,
        branchId: true,
      },
    });
    if (!account) throw new NotFoundError("Corporate account not found");
    assertFirmAccess(user, account.firmId);

    const periodEnd = new Date(input.periodEnd);
    periodEnd.setHours(23, 59, 59, 999);

    const orders = await prisma.order.findMany({
      where: {
        b2bAccountId: account.id,
        status: { notIn: ["CANCELLED", "REFUNDED"] },
        placedAt: { gte: input.periodStart, lte: periodEnd },
      },
      orderBy: { placedAt: "asc" },
      select: {
        id: true,
        orderNumber: true,
        placedAt: true,
        totalPieces: true,
        taxableAmount: true,
        totalAmount: true,
        paidAmount: true,
        branchId: true,
        gstRate: true,
      },
    });

    if (orders.length === 0) {
      throw new BusinessRuleError("No billable orders fall in that period");
    }

    const total = round2(orders.reduce((sum, order) => sum + num(order.totalAmount), 0));
    const paid = round2(orders.reduce((sum, order) => sum + num(order.paidAmount), 0));
    const taxable = round2(orders.reduce((sum, order) => sum + num(order.taxableAmount), 0));
    const gstRate = num(orders[0].gstRate);
    const gstAmount = round2(total - taxable);
    const gstSplit = splitGst(gstAmount, false);
    const branchId = account.branchId ?? orders[0].branchId;

    const statement = await prisma.$transaction(async (tx) => {
      const created = await tx.b2BStatement.upsert({
        where: {
          accountId_periodStart_periodEnd: {
            accountId: account.id,
            periodStart: input.periodStart,
            periodEnd: periodEnd,
          },
        },
        create: {
          statementNumber: await nextStatementNumber(tx),
          accountId: account.id,
          periodStart: input.periodStart,
          periodEnd,
          orderCount: orders.length,
          totalAmount: total,
          paidAmount: paid,
          dueAmount: round2(total - paid),
          status: paid >= total ? "PAID" : "ISSUED",
        },
        update: {
          orderCount: orders.length,
          totalAmount: total,
          paidAmount: paid,
          dueAmount: round2(total - paid),
          status: paid >= total ? "PAID" : "ISSUED",
        },
      });

      await tx.invoice.create({
        data: {
          invoiceNumber: await nextInvoiceNumber(tx),
          type: "B2B_MONTHLY",
          status: paid >= total ? "PAID" : "ISSUED",
          branchId,
          firmId: account.firmId,
          b2bAccountId: account.id,
          periodStart: input.periodStart,
          periodEnd,
          billToName: account.businessName,
          billToPhone: account.phone,
          billToEmail: account.email,
          billToAddress: account.billingAddress,
          billToGstin: account.gstNumber,
          subtotal: taxable,
          taxableAmount: taxable,
          gstRate,
          cgstAmount: gstSplit.cgstAmount,
          sgstAmount: gstSplit.sgstAmount,
          igstAmount: gstSplit.igstAmount,
          totalAmount: total,
          amountPaid: paid,
          amountDue: round2(total - paid),
          issuedById: user.id,
          notes: `Consolidated statement ${created.statementNumber} covering ${orders.length} orders`,
          lines: {
            create: orders.map((order) => ({
              orderId: order.id,
              description: `${order.orderNumber} · ${formatDate(order.placedAt)} · ${order.totalPieces} garments`,
              quantity: order.totalPieces,
              unitPrice:
                order.totalPieces > 0
                  ? round2(num(order.totalAmount) / order.totalPieces)
                  : num(order.totalAmount),
              lineTotal: num(order.totalAmount),
            })),
          },
        },
      });

      return created;
    });

    await recordAudit({
      userId: user.id,
      branchId,
      action: "B2B_STATEMENT_GENERATED",
      entity: "B2BStatement",
      entityId: statement.id,
      summary: `${statement.statementNumber} for ${account.businessName}: ${orders.length} orders, ${formatCurrency(total)}`,
    });

    revalidatePath(`/b2b/${account.id}`);
    revalidatePath("/billing");
    return {
      statementNumber: statement.statementNumber,
      orderCount: orders.length,
      total,
    };
  });
}
