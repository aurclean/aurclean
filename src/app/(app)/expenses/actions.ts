"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";
import { assertFirmAccess, authorize, requireFirmId, requireWriteBranch } from "@/lib/session";
import { runAction, type ActionResult, BusinessRuleError, NotFoundError } from "@/lib/action-result";
import { nextExpenseNumber } from "@/lib/sequence";

const expenseSchema = z.object({
  id: z.string().optional(),
  branchId: z.string().optional(),
  category: z.enum([
    "RENT",
    "SALARY",
    "UTILITIES",
    "MAINTENANCE",
    "TRANSPORT",
    "CONSUMABLES",
    "MARKETING",
    "MISCELLANEOUS",
  ]),
  amount: z.number().positive("Amount must be greater than 0"),
  description: z.string().trim().min(2, "Description is required"),
  paidTo: z.string().trim().optional(),
  paymentMethod: z.enum(["CASH", "UPI", "CARD", "ONLINE", "BANK_TRANSFER", "CREDIT", "OTHER"]).default("CASH"),
  reference: z.string().trim().optional(),
  expenseDate: z.coerce.date(),
});

export async function saveExpenseAction(payload: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.EXPENSE_MANAGE);
    const input = expenseSchema.parse(payload);
    const branchId = await requireWriteBranch(user, input.branchId);

    if (input.id) {
      const existing = await prisma.expense.findUnique({ where: { id: input.id } });
      if (!existing) throw new NotFoundError("Expense record not found");
      assertFirmAccess(user, existing.firmId);

      const updated = await prisma.expense.update({
        where: { id: input.id },
        data: {
          category: input.category,
          amount: input.amount,
          description: input.description,
          paidTo: input.paidTo ?? null,
          paymentMethod: input.paymentMethod,
          reference: input.reference ?? null,
          expenseDate: input.expenseDate,
        },
      });

      await recordAudit({
        userId: user.id,
        branchId,
        action: "EXPENSE_UPDATED",
        entity: "Expense",
        entityId: updated.id,
        summary: `Updated expense ${updated.expenseNumber} — ₹${input.amount} (${input.category})`,
      });

      revalidatePath("/expenses");
      return { id: updated.id };
    }

    const expenseNumber = await nextExpenseNumber();

    const created = await prisma.expense.create({
      data: {
        expenseNumber,
        branchId,
        firmId: requireFirmId(user),
        category: input.category,
        amount: input.amount,
        description: input.description,
        paidTo: input.paidTo ?? null,
        paymentMethod: input.paymentMethod,
        reference: input.reference ?? null,
        expenseDate: input.expenseDate,
        status: "PAID",
        createdById: user.id,
      },
    });

    await recordAudit({
      userId: user.id,
      branchId,
      action: "EXPENSE_CREATED",
      entity: "Expense",
      entityId: created.id,
      summary: `Created expense ${created.expenseNumber} — ₹${input.amount} (${input.category})`,
    });

    revalidatePath("/expenses");
    return { id: created.id };
  });
}

export async function deleteExpenseAction(id: string): Promise<ActionResult<{ success: boolean }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.EXPENSE_MANAGE);

    const expense = await prisma.expense.findUnique({ where: { id } });
    if (!expense) throw new NotFoundError("Expense record not found");
    assertFirmAccess(user, expense.firmId);

    await prisma.expense.delete({ where: { id } });

    await recordAudit({
      userId: user.id,
      branchId: expense.branchId,
      action: "EXPENSE_DELETED",
      entity: "Expense",
      entityId: id,
      summary: `Deleted expense ${expense.expenseNumber} (₹${expense.amount})`,
    });

    revalidatePath("/expenses");
    return { success: true };
  });
}
