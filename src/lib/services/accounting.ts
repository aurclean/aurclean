import "server-only";

import { prisma } from "@/lib/prisma";
import { num, round2 } from "@/lib/money";
import { todayRange, type DateRange } from "@/lib/dates";
import { recordAudit } from "@/lib/audit";
import { nextLedgerReference, nextTransferReference, nextReconciliationReference } from "@/lib/sequence";
import type { Prisma } from "@/generated/prisma/client";
import type {
  FinancialAccountCategory,
  PaymentMethod,
  BankTxnType,
  CashTxnType,
  ReconciliationType,
} from "@/generated/prisma/enums";

export interface FinancialOverviewMetrics {
  totalRevenue: number;
  totalExpenses: number;
  netCashFlow: number;
  cashInHand: number;
  bankBalance: number;
  customerReceivables: number;
  supplierPayables: number;
  todayIncoming: number;
  todayOutgoing: number;
  netToday: number;
}

/**
 * Computes centralized real-time financial metrics from transaction data.
 * No separate formulas or hardcoded numbers — everything rolls up from active ledgers & accounts.
 */
export async function getFinancialOverview(
  firmId: string,
  branchId?: string,
): Promise<FinancialOverviewMetrics> {
  const today = todayRange();
  const branchWhere = branchId ? { branchId } : {};

  const [
    ordersAggregate,
    expensesAggregate,
    cashAccount,
    bankAccounts,
    customersAggregate,
    suppliersAggregate,
    todayIncomingAgg,
    todayOutgoingAgg,
  ] = await Promise.all([
    prisma.order.aggregate({
      where: {
        firmId,
        ...branchWhere,
        status: { notIn: ["CANCELLED", "REFUNDED"] },
      },
      _sum: { totalAmount: true, paidAmount: true },
    }),
    prisma.expense.aggregate({
      where: {
        firmId,
        ...branchWhere,
        status: { in: ["APPROVED", "PAID"] },
      },
      _sum: { amount: true },
    }),
    prisma.cashAccount.findFirst({
      where: { branch: { firmId }, ...(branchId ? { branchId } : {}) },
    }),
    prisma.bankAccount.findMany({
      where: {
        firmId,
        ...(branchId ? { branchId } : {}),
        status: "ACTIVE",
      },
      select: { currentBalance: true },
    }),
    prisma.customer.aggregate({
      where: { firmId, ...(branchId ? { branchId } : {}) },
      _sum: { outstandingAmount: true },
    }),
    prisma.purchaseInvoice.findMany({
      where: {
        supplier: { firmId },
        status: { in: ["UNPAID", "PARTIALLY_PAID", "OVERDUE"] },
      },
      select: { total: true, amountPaid: true },
    }),
    prisma.payment.aggregate({
      where: {
        firmId,
        ...branchWhere,
        state: "CAPTURED",
        paidAt: { gte: today.from, lte: today.to },
      },
      _sum: { amount: true },
    }),
    prisma.financialLedger.aggregate({
      where: {
        firmId,
        ...branchWhere,
        entryDate: { gte: today.from, lte: today.to },
        debit: { gt: 0 },
        accountCategory: { in: ["EXPENSE", "PAYABLES", "PURCHASE"] },
        isVoided: false,
      },
      _sum: { debit: true },
    }),
  ]);

  const totalRevenue = num(ordersAggregate._sum.totalAmount);
  const totalExpenses = num(expensesAggregate._sum.amount);
  const cashInHand = num(cashAccount?.currentBalance ?? 0);
  const bankBalance = round2(bankAccounts.reduce((sum, b) => sum + num(b.currentBalance), 0));
  const customerReceivables = num(customersAggregate._sum.outstandingAmount);

  const supplierPayables = round2(
    suppliersAggregate.reduce((sum, inv) => sum + num(inv.total) - num(inv.amountPaid), 0),
  );

  const todayIncoming = num(todayIncomingAgg._sum.amount);
  const todayOutgoing = num(todayOutgoingAgg._sum.debit);
  const netToday = round2(todayIncoming - todayOutgoing);
  const netCashFlow = round2(cashInHand + bankBalance);

  return {
    totalRevenue,
    totalExpenses,
    netCashFlow,
    cashInHand,
    bankBalance,
    customerReceivables,
    supplierPayables,
    todayIncoming,
    todayOutgoing,
    netToday,
  };
}

export interface PostLedgerInput {
  branchId: string;
  firmId: string;
  reference: string;
  description: string;
  accountCategory: FinancialAccountCategory;
  debit?: number;
  credit?: number;
  paymentMethod?: PaymentMethod;
  bankAccountId?: string | null;
  customerId?: string | null;
  supplierId?: string | null;
  orderId?: string | null;
  expenseId?: string | null;
  purchaseOrderId?: string | null;
  userId: string;
}

/**
 * Central posting engine for all financial events.
 * Inserts ledger entry and updates Cash or Bank account balances atomically.
 */
export async function postFinancialTransaction(input: PostLedgerInput) {
  const debit = round2(input.debit ?? 0);
  const credit = round2(input.credit ?? 0);
  const paymentMethod = input.paymentMethod ?? "CASH";

  return await prisma.$transaction(async (tx) => {
    // 1. Maintain Cash Account balance if cash transaction
    let cashAccountId: string | null = null;
    let cashBalanceAfter = 0;

    if (paymentMethod === "CASH" || input.accountCategory === "CASH") {
      const cash = await tx.cashAccount.upsert({
        where: { branchId: input.branchId },
        create: { branchId: input.branchId, openingBalance: 0, currentBalance: 0 },
        update: {},
      });
      cashAccountId = cash.id;

      const cashDelta = credit - debit;
      cashBalanceAfter = round2(num(cash.currentBalance) + cashDelta);

      await tx.cashAccount.update({
        where: { id: cash.id },
        data: { currentBalance: cashBalanceAfter },
      });

      await tx.cashTransaction.create({
        data: {
          branchId: input.branchId,
          firmId: input.firmId,
          type: cashDelta >= 0 ? "CASH_IN" : "CASH_OUT",
          amount: Math.abs(cashDelta),
          balanceAfter: cashBalanceAfter,
          reference: input.reference,
          reason: input.description,
          createdById: input.userId,
        },
      });
    }

    // 2. Maintain Bank Account balance if bank account specified or digital payment method
    let bankBalanceAfter = 0;
    if (input.bankAccountId) {
      const bank = await tx.bankAccount.findUnique({
        where: { id: input.bankAccountId },
      });
      if (bank && bank.firmId !== input.firmId) {
        throw new Error("Bank account not found");
      }
      if (bank) {
        const bankDelta = credit - debit;
        bankBalanceAfter = round2(num(bank.currentBalance) + bankDelta);

        await tx.bankAccount.update({
          where: { id: bank.id },
          data: { currentBalance: bankBalanceAfter },
        });

        await tx.bankTransaction.create({
          data: {
            bankAccountId: bank.id,
            branchId: input.branchId,
            type: bankDelta >= 0 ? "DEPOSIT" : "WITHDRAWAL",
            amount: Math.abs(bankDelta),
            balanceAfter: bankBalanceAfter,
            reference: input.reference,
            description: input.description,
            createdById: input.userId,
          },
        });
      }
    }

    // 3. Create central FinancialLedger entry
    const ledger = await tx.financialLedger.create({
      data: {
        branchId: input.branchId,
        firmId: input.firmId,
        reference: input.reference,
        description: input.description,
        accountCategory: input.accountCategory,
        debit,
        credit,
        balanceAfter: paymentMethod === "CASH" ? cashBalanceAfter : bankBalanceAfter,
        paymentMethod,
        bankAccountId: input.bankAccountId ?? null,
        customerId: input.customerId ?? null,
        supplierId: input.supplierId ?? null,
        orderId: input.orderId ?? null,
        expenseId: input.expenseId ?? null,
        purchaseOrderId: input.purchaseOrderId ?? null,
        createdById: input.userId,
      },
    });

    return ledger;
  });
}

/**
 * Transfers funds between Cash and a Bank Account (or vice-versa).
 * Uses linked transaction references so it is never misclassified as business income/expense.
 */
export async function transferCashBank(params: {
  branchId: string;
  firmId: string;
  bankAccountId: string;
  amount: number;
  direction: "CASH_TO_BANK" | "BANK_TO_CASH";
  notes?: string;
  userId: string;
}) {
  const amount = round2(params.amount);
  const ref = await nextTransferReference();

  return await prisma.$transaction(async (tx) => {
    const bank = await tx.bankAccount.findUnique({ where: { id: params.bankAccountId } });
    if (!bank || bank.firmId !== params.firmId) throw new Error("Bank account not found");

    const cash = await tx.cashAccount.upsert({
      where: { branchId: params.branchId },
      create: { branchId: params.branchId, openingBalance: 0, currentBalance: 0 },
      update: {},
    });

    if (params.direction === "CASH_TO_BANK") {
      if (num(cash.currentBalance) < amount) {
        throw new Error(`Insufficient cash in hand (Available: ₹${num(cash.currentBalance)})`);
      }
      const newCashBal = round2(num(cash.currentBalance) - amount);
      const newBankBal = round2(num(bank.currentBalance) + amount);

      await tx.cashAccount.update({ where: { id: cash.id }, data: { currentBalance: newCashBal } });
      await tx.bankAccount.update({ where: { id: bank.id }, data: { currentBalance: newBankBal } });

      await tx.cashTransaction.create({
        data: {
          branchId: params.branchId,
          firmId: params.firmId,
          type: "DEPOSIT_TO_BANK",
          amount,
          balanceAfter: newCashBal,
          reference: ref,
          reason: `Deposit to ${bank.bankName} (${bank.accountName}): ${params.notes || "Cash transfer"}`,
          createdById: params.userId,
        },
      });

      await tx.bankTransaction.create({
        data: {
          bankAccountId: bank.id,
          branchId: params.branchId,
          type: "TRANSFER_IN",
          amount,
          balanceAfter: newBankBal,
          reference: ref,
          description: `Cash deposit into account: ${params.notes || "Cash transfer"}`,
          createdById: params.userId,
        },
      });

      await tx.financialLedger.create({
        data: {
          branchId: params.branchId,
          firmId: params.firmId,
          reference: ref,
          description: `Cash Deposit -> ${bank.bankName} (${bank.accountName})`,
          accountCategory: "TRANSFER",
          debit: amount,
          credit: amount,
          balanceAfter: newBankBal,
          paymentMethod: "CASH",
          bankAccountId: bank.id,
          createdById: params.userId,
        },
      });
    } else {
      if (num(bank.currentBalance) < amount) {
        throw new Error(`Insufficient bank account balance (Available: ₹${num(bank.currentBalance)})`);
      }
      const newBankBal = round2(num(bank.currentBalance) - amount);
      const newCashBal = round2(num(cash.currentBalance) + amount);

      await tx.bankAccount.update({ where: { id: bank.id }, data: { currentBalance: newBankBal } });
      await tx.cashAccount.update({ where: { id: cash.id }, data: { currentBalance: newCashBal } });

      await tx.bankTransaction.create({
        data: {
          bankAccountId: bank.id,
          branchId: params.branchId,
          type: "TRANSFER_OUT",
          amount,
          balanceAfter: newBankBal,
          reference: ref,
          description: `Cash withdrawal from account: ${params.notes || "Bank withdrawal"}`,
          createdById: params.userId,
        },
      });

      await tx.cashTransaction.create({
        data: {
          branchId: params.branchId,
          firmId: params.firmId,
          type: "WITHDRAWAL_FROM_BANK",
          amount,
          balanceAfter: newCashBal,
          reference: ref,
          reason: `Withdrawal from ${bank.bankName} (${bank.accountName}): ${params.notes || "Bank withdrawal"}`,
          createdById: params.userId,
        },
      });

      await tx.financialLedger.create({
        data: {
          branchId: params.branchId,
          firmId: params.firmId,
          reference: ref,
          description: `Bank Withdrawal -> Cash in Hand (${bank.bankName})`,
          accountCategory: "TRANSFER",
          debit: amount,
          credit: amount,
          balanceAfter: newCashBal,
          paymentMethod: "BANK_TRANSFER",
          bankAccountId: bank.id,
          createdById: params.userId,
        },
      });
    }

    return { reference: ref };
  });
}

export interface LedgerQueryFilters {
  firmId: string;
  branchId?: string;
  category?: FinancialAccountCategory;
  search?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface LedgerRow {
  id: string;
  entryDate: string;
  reference: string;
  description: string;
  accountCategory: string;
  debit: number;
  credit: number;
  balanceAfter: number;
  paymentMethod: string;
  isVoided: boolean;
  voidReason: string | null;
  createdByName: string | null;
}

export async function listLedgerEntries(filters: LedgerQueryFilters): Promise<{
  rows: LedgerRow[];
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
}> {
  const branchWhere = filters.branchId ? { branchId: filters.branchId } : {};

  const entries = await prisma.financialLedger.findMany({
    where: {
      firmId: filters.firmId,
      ...branchWhere,
      ...(filters.category ? { accountCategory: filters.category } : {}),
      ...(filters.from || filters.to
        ? {
            entryDate: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
      ...(filters.search
        ? {
            OR: [
              { reference: { contains: filters.search, mode: "insensitive" } },
              { description: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { createdBy: { select: { name: true } } },
    orderBy: { entryDate: "desc" },
    take: filters.limit ?? 200,
  });

  let totalDebit = 0;
  let totalCredit = 0;

  const rows = entries.map((e) => {
    const d = num(e.debit);
    const c = num(e.credit);
    if (!e.isVoided) {
      totalDebit = round2(totalDebit + d);
      totalCredit = round2(totalCredit + c);
    }
    return {
      id: e.id,
      entryDate: e.entryDate.toISOString(),
      reference: e.reference,
      description: e.description,
      accountCategory: e.accountCategory,
      debit: d,
      credit: c,
      balanceAfter: num(e.balanceAfter),
      paymentMethod: e.paymentMethod,
      isVoided: e.isVoided,
      voidReason: e.voidReason,
      createdByName: e.createdBy?.name ?? null,
    };
  });

  const closingBalance = round2(totalCredit - totalDebit);
  const openingBalance = 0;

  return { rows, openingBalance, totalDebit, totalCredit, closingBalance };
}

export async function voidLedgerEntry(params: {
  ledgerId: string;
  reason: string;
  userId: string;
  firmId: string;
}) {
  return await prisma.$transaction(async (tx) => {
    const entry = await tx.financialLedger.findUnique({ where: { id: params.ledgerId } });
    if (!entry) throw new Error("Ledger entry not found");
    if (entry.firmId !== params.firmId) throw new Error("Ledger entry not found");
    if (entry.isVoided) throw new Error("Ledger entry is already voided");

    await tx.financialLedger.update({
      where: { id: params.ledgerId },
      data: {
        isVoided: true,
        voidReason: params.reason,
        voidedAt: new Date(),
        voidedById: params.userId,
      },
    });

    const revRef = `REV-${entry.reference}`;

    // Post balancing reversal entry
    await tx.financialLedger.create({
      data: {
        branchId: entry.branchId,
        firmId: entry.firmId,
        reference: revRef,
        description: `VOIDING: ${entry.description} (Reason: ${params.reason})`,
        accountCategory: "ADJUSTMENT",
        debit: num(entry.credit),
        credit: num(entry.debit),
        balanceAfter: num(entry.balanceAfter),
        paymentMethod: entry.paymentMethod,
        createdById: params.userId,
      },
    });

    // Revert Cash/Bank balances
    if (entry.paymentMethod === "CASH" || entry.accountCategory === "CASH") {
      const cash = await tx.cashAccount.findFirst({ where: { branchId: entry.branchId } });
      if (cash) {
        const revertDelta = num(entry.debit) - num(entry.credit);
        const newBal = round2(num(cash.currentBalance) + revertDelta);
        await tx.cashAccount.update({ where: { id: cash.id }, data: { currentBalance: newBal } });
      }
    }

    if (entry.bankAccountId) {
      const bank = await tx.bankAccount.findUnique({ where: { id: entry.bankAccountId } });
      if (bank) {
        const revertDelta = num(entry.debit) - num(entry.credit);
        const newBal = round2(num(bank.currentBalance) + revertDelta);
        await tx.bankAccount.update({ where: { id: bank.id }, data: { currentBalance: newBal } });
      }
    }

    return { success: true, reversalReference: revRef };
  });
}

// ----------------------------------------------------------------------------
// CASH & BANK ACCOUNTS SERVICE
// ----------------------------------------------------------------------------

export async function getCashAccountSummary(branchId: string) {
  const cash = await prisma.cashAccount.upsert({
    where: { branchId },
    create: { branchId, openingBalance: 0, currentBalance: 0 },
    update: {},
  });

  const txns = await prisma.cashTransaction.findMany({
    where: { branchId },
    include: { createdBy: { select: { name: true } } },
    orderBy: { txnDate: "desc" },
    take: 100,
  });

  let totalCashIn = 0;
  let totalCashOut = 0;

  const rows = txns.map((t) => {
    const amt = num(t.amount);
    if (t.type === "CASH_IN" || t.type === "WITHDRAWAL_FROM_BANK") {
      totalCashIn = round2(totalCashIn + amt);
    } else {
      totalCashOut = round2(totalCashOut + amt);
    }
    return {
      id: t.id,
      txnDate: t.txnDate.toISOString(),
      type: t.type,
      amount: amt,
      balanceAfter: num(t.balanceAfter),
      reference: t.reference,
      reason: t.reason,
      createdByName: t.createdBy?.name ?? null,
    };
  });

  return {
    openingBalance: num(cash.openingBalance),
    currentBalance: num(cash.currentBalance),
    totalCashIn,
    totalCashOut,
    transactions: rows,
  };
}

export async function listBankAccounts(firmId: string, branchId?: string) {
  const accounts = await prisma.bankAccount.findMany({
    where: { firmId, ...(branchId ? { branchId } : {}) },
    orderBy: { createdAt: "asc" },
  });

  return accounts.map((a) => ({
    id: a.id,
    branchId: a.branchId,
    accountName: a.accountName,
    bankName: a.bankName,
    accountNumberMasked: a.accountNumber.length > 4 ? `XXXX-XXXX-${a.accountNumber.slice(-4)}` : a.accountNumber,
    accountNumber: a.accountNumber,
    ifscCode: a.ifscCode,
    openingBalance: num(a.openingBalance),
    currentBalance: num(a.currentBalance),
    status: a.status,
  }));
}

export async function saveBankAccount(params: {
  id?: string;
  branchId: string;
  firmId: string;
  accountName: string;
  bankName: string;
  accountNumber: string;
  ifscCode?: string;
  openingBalance?: number;
  userId: string;
}) {
  const openingBal = round2(params.openingBalance ?? 0);

  if (params.id) {
    const existing = await prisma.bankAccount.findUnique({
      where: { id: params.id },
      select: { firmId: true },
    });
    if (!existing || existing.firmId !== params.firmId) {
      throw new Error("Bank account not found");
    }
    return await prisma.bankAccount.update({
      where: { id: params.id },
      data: {
        accountName: params.accountName,
        bankName: params.bankName,
        accountNumber: params.accountNumber,
        ifscCode: params.ifscCode ?? null,
      },
    });
  }

  return await prisma.bankAccount.create({
    data: {
      branchId: params.branchId,
      firmId: params.firmId,
      accountName: params.accountName,
      bankName: params.bankName,
      accountNumber: params.accountNumber,
      ifscCode: params.ifscCode ?? null,
      openingBalance: openingBal,
      currentBalance: openingBal,
    },
  });
}

// ----------------------------------------------------------------------------
// RECONCILIATION & REPORTS
// ----------------------------------------------------------------------------

export async function listReconciliations(branchId?: string) {
  const rows = await prisma.reconciliation.findMany({
    where: branchId ? { branchId } : {},
    include: {
      bankAccount: { select: { bankName: true, accountName: true } },
      createdBy: { select: { name: true } },
    },
    orderBy: { reconciledDate: "desc" },
    take: 50,
  });

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    bankName: r.bankAccount ? `${r.bankAccount.bankName} (${r.bankAccount.accountName})` : "Cash in Hand",
    reconciledDate: r.reconciledDate.toISOString(),
    expectedBalance: num(r.expectedBalance),
    actualBalance: num(r.actualBalance),
    difference: num(r.difference),
    adjustmentNotes: r.adjustmentNotes,
    createdByName: r.createdBy?.name ?? null,
  }));
}

export async function postReconciliation(params: {
  branchId: string;
  firmId: string;
  type: ReconciliationType;
  bankAccountId?: string | null;
  expectedBalance: number;
  actualBalance: number;
  adjustmentNotes: string;
  userId: string;
}) {
  const difference = round2(params.actualBalance - params.expectedBalance);

  return await prisma.$transaction(async (tx) => {
    if (params.bankAccountId) {
      const bank = await tx.bankAccount.findUnique({
        where: { id: params.bankAccountId },
        select: { firmId: true },
      });
      if (!bank || bank.firmId !== params.firmId) {
        throw new Error("Bank account not found");
      }
    }

    const rec = await tx.reconciliation.create({
      data: {
        branchId: params.branchId,
        type: params.type,
        bankAccountId: params.bankAccountId ?? null,
        expectedBalance: params.expectedBalance,
        actualBalance: params.actualBalance,
        difference,
        adjustmentNotes: params.adjustmentNotes,
        createdById: params.userId,
      },
    });

    if (difference !== 0) {
      const ref = await nextReconciliationReference();
      if (params.type === "CASH") {
        await tx.cashAccount.update({
          where: { branchId: params.branchId },
          data: { currentBalance: params.actualBalance },
        });

        await tx.cashTransaction.create({
          data: {
            branchId: params.branchId,
            firmId: params.firmId,
            type: "ADJUSTMENT",
            amount: Math.abs(difference),
            balanceAfter: params.actualBalance,
            reference: ref,
            reason: `Reconciliation adjustment: ${params.adjustmentNotes}`,
            createdById: params.userId,
          },
        });
      } else if (params.bankAccountId) {
        await tx.bankAccount.update({
          where: { id: params.bankAccountId },
          data: { currentBalance: params.actualBalance },
        });
      }
    }

    return rec;
  });
}

// ----------------------------------------------------------------------------
// PROFIT & LOSS REPORT
// ----------------------------------------------------------------------------

export async function getPnLReport(filters: {
  firmId: string;
  branchId?: string;
  from?: Date;
  to?: Date;
}) {
  const branchWhere = filters.branchId ? { branchId: filters.branchId } : {};
  const dateWhere = filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined;

  const [orders, expenses, purchases] = await Promise.all([
    prisma.order.aggregate({
      where: {
        firmId: filters.firmId,
        ...branchWhere,
        status: { notIn: ["CANCELLED", "REFUNDED"] },
        ...(dateWhere ? { placedAt: dateWhere } : {}),
      },
      _sum: { totalAmount: true },
    }),
    prisma.expense.groupBy({
      by: ["category"],
      where: {
        firmId: filters.firmId,
        ...branchWhere,
        status: { in: ["APPROVED", "PAID"] },
        ...(dateWhere ? { expenseDate: dateWhere } : {}),
      },
      _sum: { amount: true },
    }),
    prisma.purchaseOrder.aggregate({
      where: {
        firmId: filters.firmId,
        ...branchWhere,
        status: { in: ["RECEIVED", "PARTIALLY_RECEIVED"] },
        ...(dateWhere ? { orderDate: dateWhere } : {}),
      },
      _sum: { total: true },
    }),
  ]);

  const salesRevenue = num(orders._sum.totalAmount);
  const cogsPurchases = num(purchases._sum.total);

  let totalOperatingExpenses = 0;
  const expenseBreakdown = expenses.map((e) => {
    const val = num(e._sum.amount);
    totalOperatingExpenses = round2(totalOperatingExpenses + val);
    return { category: e.category, amount: val };
  });

  const totalCost = round2(cogsPurchases + totalOperatingExpenses);
  const netProfit = round2(salesRevenue - totalCost);

  return {
    salesRevenue,
    otherIncome: 0,
    grossRevenue: salesRevenue,
    cogsPurchases,
    operatingExpenses: totalOperatingExpenses,
    expenseBreakdown,
    totalExpenses: totalCost,
    netProfit,
  };
}
