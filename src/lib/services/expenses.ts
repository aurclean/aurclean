import "server-only";

import { prisma } from "@/lib/prisma";
import { num, round2 } from "@/lib/money";
import type { ExpenseCategory, PaymentMethod, ExpenseStatus } from "@/generated/prisma/enums";

export interface ExpenseFilters {
  firmId: string;
  branchId?: string;
  category?: ExpenseCategory;
  search?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface ExpenseRow {
  id: string;
  expenseNumber: string;
  branchId: string;
  branchName: string;
  category: ExpenseCategory;
  amount: number;
  description: string;
  paidTo: string | null;
  paymentMethod: PaymentMethod;
  reference: string | null;
  expenseDate: string;
  status: ExpenseStatus;
  createdByName: string | null;
  createdAt: string;
}

export async function listExpenses(filters: ExpenseFilters): Promise<ExpenseRow[]> {
  const rows = await prisma.expense.findMany({
    where: {
      firmId: filters.firmId,
      ...(filters.branchId ? { branchId: filters.branchId } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.from || filters.to
        ? {
            expenseDate: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
      ...(filters.search
        ? {
            OR: [
              { expenseNumber: { contains: filters.search, mode: "insensitive" } },
              { description: { contains: filters.search, mode: "insensitive" } },
              { paidTo: { contains: filters.search, mode: "insensitive" } },
              { reference: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      branch: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: { expenseDate: "desc" },
    take: filters.limit ?? 100,
  });

  return rows.map((r) => ({
    id: r.id,
    expenseNumber: r.expenseNumber,
    branchId: r.branchId,
    branchName: r.branch.name,
    category: r.category,
    amount: num(r.amount),
    description: r.description,
    paidTo: r.paidTo,
    paymentMethod: r.paymentMethod,
    reference: r.reference,
    expenseDate: r.expenseDate.toISOString(),
    status: r.status,
    createdByName: r.createdBy?.name ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getMonthlyExpenseSummary(firmId: string, branchId?: string): Promise<{
  currentMonthTotal: number;
  categoryTotals: Record<string, number>;
}> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const expenses = await prisma.expense.findMany({
    where: {
      firmId,
      ...(branchId ? { branchId } : {}),
      expenseDate: { gte: startOfMonth, lte: endOfMonth },
      status: { in: ["APPROVED", "PAID", "PENDING"] },
    },
    select: { amount: true, category: true },
  });

  let currentMonthTotal = 0;
  const categoryTotals: Record<string, number> = {};

  for (const exp of expenses) {
    const val = num(exp.amount);
    currentMonthTotal = round2(currentMonthTotal + val);
    categoryTotals[exp.category] = round2((categoryTotals[exp.category] ?? 0) + val);
  }

  return { currentMonthTotal, categoryTotals };
}
