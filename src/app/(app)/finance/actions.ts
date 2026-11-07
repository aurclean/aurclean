"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";
import { assertFirmAccess, authorize, requireFirmId, requireWriteBranch } from "@/lib/session";
import { runAction, type ActionResult, BusinessRuleError, NotFoundError } from "@/lib/action-result";
import {
  postFinancialTransaction,
  transferCashBank,
  voidLedgerEntry,
  saveBankAccount,
  postReconciliation,
} from "@/lib/services/accounting";
import { nextPaymentNumber, nextExpenseNumber, nextLedgerReference } from "@/lib/sequence";

const recordIncomingSchema = z.object({
  branchId: z.string().optional(),
  customerId: z.string().trim().optional(),
  orderId: z.string().trim().optional(),
  amount: z.number().positive("Amount must be greater than 0"),
  paymentMethod: z.enum(["CASH", "UPI", "CARD", "ONLINE", "BANK_TRANSFER", "CREDIT", "OTHER"]).default("CASH"),
  bankAccountId: z.string().trim().optional(),
  description: z.string().trim().min(2, "Description is required"),
  notes: z.string().trim().optional(),
});

export async function recordIncomingMoneyAction(payload: unknown): Promise<ActionResult<{ reference: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.BILLING_RECORD_PAYMENT);
    const input = recordIncomingSchema.parse(payload);
    const branchId = await requireWriteBranch(user, input.branchId);

    const payRef = await nextPaymentNumber();

    // 1. If linked to an order, update order paid amount & outstanding
    if (input.orderId) {
      const order = await prisma.order.findUnique({ where: { id: input.orderId } });
      if (!order) throw new NotFoundError("Order not found");
      assertFirmAccess(user, order.firmId);

      const newPaid = Number(order.paidAmount) + input.amount;
      const newOut = Math.max(0, Number(order.totalAmount) - newPaid);
      const newStatus = newOut === 0 ? "PAID" : "PARTIALLY_PAID";

      await prisma.order.update({
        where: { id: order.id },
        data: { paidAmount: newPaid, outstandingAmount: newOut, paymentStatus: newStatus },
      });

      await prisma.payment.create({
        data: {
          paymentNumber: payRef,
          orderId: order.id,
          branchId,
          firmId: order.firmId,
          amount: input.amount,
          method: input.paymentMethod,
          state: "CAPTURED",
          reference: payRef,
          bankAccountId: input.bankAccountId || null,
          receivedById: user.id,
        },
      });
    }

    // 2. Post to Central Financial Ledger
    await postFinancialTransaction({
      branchId,
      firmId: requireFirmId(user),
      reference: payRef,
      description: input.description,
      accountCategory: "SALES",
      credit: input.amount,
      paymentMethod: input.paymentMethod,
      bankAccountId: input.bankAccountId || null,
      customerId: input.customerId || null,
      orderId: input.orderId || null,
      userId: user.id,
    });

    await recordAudit({
      userId: user.id,
      branchId,
      action: "INCOMING_MONEY_RECORDED",
      entity: "Payment",
      summary: `Incoming ₹${input.amount} (${input.paymentMethod}) — ${input.description}`,
    });

    revalidatePath("/finance/ledger");
    revalidatePath("/finance/incoming");
    revalidatePath("/dashboard");
    return { reference: payRef };
  });
}

const recordOutgoingSchema = z.object({
  branchId: z.string().optional(),
  payee: z.string().trim().optional(),
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
  paymentMethod: z.enum(["CASH", "UPI", "CARD", "ONLINE", "BANK_TRANSFER", "CREDIT", "OTHER"]).default("CASH"),
  bankAccountId: z.string().trim().optional(),
  description: z.string().trim().min(2, "Description is required"),
  notes: z.string().trim().optional(),
});

export async function recordOutgoingMoneyAction(payload: unknown): Promise<ActionResult<{ reference: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.EXPENSE_MANAGE);
    const input = recordOutgoingSchema.parse(payload);
    const branchId = await requireWriteBranch(user, input.branchId);

    const expRef = await nextExpenseNumber();

    const expense = await prisma.expense.create({
      data: {
        expenseNumber: expRef,
        branchId,
        firmId: requireFirmId(user),
        category: input.category,
        amount: input.amount,
        description: input.description,
        paidTo: input.payee ?? null,
        paymentMethod: input.paymentMethod,
        bankAccountId: input.bankAccountId || null,
        reference: expRef,
        status: "PAID",
        createdById: user.id,
      },
    });

    await postFinancialTransaction({
      branchId,
      firmId: requireFirmId(user),
      reference: expRef,
      description: `[${input.category}] ${input.description}`,
      accountCategory: "EXPENSE",
      debit: input.amount,
      paymentMethod: input.paymentMethod,
      bankAccountId: input.bankAccountId || null,
      expenseId: expense.id,
      userId: user.id,
    });

    await recordAudit({
      userId: user.id,
      branchId,
      action: "OUTGOING_MONEY_RECORDED",
      entity: "Expense",
      entityId: expense.id,
      summary: `Outgoing ₹${input.amount} (${input.category}) — ${input.description}`,
    });

    revalidatePath("/finance/ledger");
    revalidatePath("/finance/outgoing");
    revalidatePath("/expenses");
    revalidatePath("/dashboard");
    return { reference: expRef };
  });
}

const transferSchema = z.object({
  branchId: z.string().optional(),
  bankAccountId: z.string().trim().min(1, "Select bank account"),
  amount: z.number().positive("Amount must be greater than 0"),
  direction: z.enum(["CASH_TO_BANK", "BANK_TO_CASH"]),
  notes: z.string().trim().optional(),
});

export async function transferCashBankAction(payload: unknown): Promise<ActionResult<{ reference: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.FINANCE_MANAGE);
    const input = transferSchema.parse(payload);
    const branchId = await requireWriteBranch(user, input.branchId);

    const result = await transferCashBank({
      branchId,
      firmId: requireFirmId(user),
      bankAccountId: input.bankAccountId,
      amount: input.amount,
      direction: input.direction,
      notes: input.notes,
      userId: user.id,
    });

    await recordAudit({
      userId: user.id,
      branchId,
      action: "CASH_BANK_TRANSFER",
      entity: "Transfer",
      summary: `${input.direction === "CASH_TO_BANK" ? "Cash Deposit to Bank" : "Bank Withdrawal to Cash"} ₹${input.amount} (Ref: ${result.reference})`,
    });

    revalidatePath("/finance/cash");
    revalidatePath("/finance/bank-accounts");
    revalidatePath("/finance/ledger");
    return { reference: result.reference };
  });
}

const voidLedgerSchema = z.object({
  ledgerId: z.string().trim().min(1),
  reason: z.string().trim().min(3, "Reason for voiding is required"),
});

export async function voidLedgerAction(payload: unknown): Promise<ActionResult<{ success: boolean }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.FINANCE_MANAGE);
    const input = voidLedgerSchema.parse(payload);

    const result = await voidLedgerEntry({
      ledgerId: input.ledgerId,
      reason: input.reason,
      userId: user.id,
      firmId: requireFirmId(user),
    });

    await recordAudit({
      userId: user.id,
      action: "LEDGER_ENTRY_VOIDED",
      entity: "FinancialLedger",
      entityId: input.ledgerId,
      summary: `Voided ledger entry ${input.ledgerId} — Reason: ${input.reason}`,
    });

    revalidatePath("/finance/ledger");
    return { success: true };
  });
}

const bankAccountSchema = z.object({
  id: z.string().optional(),
  branchId: z.string().optional(),
  accountName: z.string().trim().min(2, "Account name required"),
  bankName: z.string().trim().min(2, "Bank name required"),
  accountNumber: z.string().trim().min(4, "Account number required"),
  ifscCode: z.string().trim().optional(),
  openingBalance: z.number().min(0).optional(),
});

export async function saveBankAccountAction(payload: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.BANK_MANAGE);
    const input = bankAccountSchema.parse(payload);
    const branchId = await requireWriteBranch(user, input.branchId);

    if (input.id) {
      const existing = await prisma.bankAccount.findUnique({
        where: { id: input.id },
        select: { firmId: true },
      });
      if (!existing) throw new NotFoundError("Bank account not found");
      assertFirmAccess(user, existing.firmId);
    }

    const bank = await saveBankAccount({
      id: input.id,
      branchId,
      firmId: requireFirmId(user),
      accountName: input.accountName,
      bankName: input.bankName,
      accountNumber: input.accountNumber,
      ifscCode: input.ifscCode,
      openingBalance: input.openingBalance,
      userId: user.id,
    });

    await recordAudit({
      userId: user.id,
      branchId,
      action: input.id ? "BANK_ACCOUNT_UPDATED" : "BANK_ACCOUNT_CREATED",
      entity: "BankAccount",
      entityId: bank.id,
      summary: `${bank.bankName} (${bank.accountName})`,
    });

    revalidatePath("/finance/bank-accounts");
    return { id: bank.id };
  });
}

const reconciliationSchema = z.object({
  branchId: z.string().optional(),
  type: z.enum(["CASH", "BANK"]),
  bankAccountId: z.string().optional(),
  expectedBalance: z.number(),
  actualBalance: z.number(),
  adjustmentNotes: z.string().trim().min(2, "Adjustment notes required"),
});

export async function submitReconciliationAction(payload: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.RECONCILE_MANAGE);
    const input = reconciliationSchema.parse(payload);
    const branchId = await requireWriteBranch(user, input.branchId);

    const rec = await postReconciliation({
      branchId,
      firmId: requireFirmId(user),
      type: input.type,
      bankAccountId: input.bankAccountId,
      expectedBalance: input.expectedBalance,
      actualBalance: input.actualBalance,
      adjustmentNotes: input.adjustmentNotes,
      userId: user.id,
    });

    await recordAudit({
      userId: user.id,
      branchId,
      action: "RECONCILIATION_PERFORMED",
      entity: "Reconciliation",
      entityId: rec.id,
      summary: `${input.type} Reconciliation — Expected: ₹${input.expectedBalance}, Actual: ₹${input.actualBalance}`,
    });

    revalidatePath("/finance/reconciliation");
    revalidatePath("/finance/cash");
    revalidatePath("/finance/bank-accounts");
    return { id: rec.id };
  });
}
