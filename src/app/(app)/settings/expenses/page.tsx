import Link from "next/link";
import { ArrowLeft, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { PageHeader as Header } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  ExpenseDecisionControls,
  ExpenseDialog,
} from "@/app/(app)/settings/settings-dialogs";
import { RowActions } from "@/components/shared/row-actions";
import { deleteExpenseAction } from "@/app/(app)/settings/actions";
import { prisma } from "@/lib/prisma";
import { formatCurrency, num } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { humanize } from "@/lib/utils";
import {
  branchOptions,
  dateRangeFrom,
  enumOptions,
  param,
  scopedBranchId,
  type SearchParams,
} from "@/lib/queries/filters";
import type { Prisma } from "@/generated/prisma/client";

export const metadata = { title: "Expenses" };

const CATEGORIES = [
  "RENT",
  "SALARY",
  "UTILITIES",
  "MAINTENANCE",
  "TRANSPORT",
  "CONSUMABLES",
  "MARKETING",
  "MISCELLANEOUS",
] as const;

interface ExpenseRow {
  id: string;
  expenseNumber: string;
  category: string;
  status: string;
  amount: number;
  description: string;
  paidTo: string | null;
  expenseDate: Date;
  branchName: string;
  createdBy: string | null;
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requirePermission(PERMISSIONS.EXPENSE_VIEW);

  const branchId = scopedBranchId(user, params);
  const firmId = requireFirmId(user);
  const range = dateRangeFrom(params);
  const category = param(params, "category");
  const status = param(params, "status");
  const search = param(params, "q");

  const where: Prisma.ExpenseWhereInput = {
    firmId,
    ...(branchId ? { branchId } : {}),
    ...(category && category !== "all" ? { category: category as never } : {}),
    ...(status && status !== "all" ? { status: status as never } : {}),
    ...(range ? { expenseDate: { gte: range.from, lte: range.to } } : {}),
    ...(search
      ? {
          OR: [
            { expenseNumber: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
            { paidTo: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [expenses, totals, pendingCount, branches] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { expenseDate: "desc" },
      take: 100,
      include: {
        branch: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
    }),
    prisma.expense.aggregate({
      where: { ...where, status: { in: ["APPROVED", "PAID"] } },
      _sum: { amount: true },
    }),
    prisma.expense.count({
      where: { firmId, ...(branchId ? { branchId } : {}), status: "PENDING" },
    }),
    branchOptions(user),
  ]);

  const canManage = hasPermission(user, PERMISSIONS.EXPENSE_MANAGE);
  const canApprove = hasPermission(user, PERMISSIONS.EXPENSE_APPROVE);

  const rows: ExpenseRow[] = expenses.map((expense) => ({
    id: expense.id,
    expenseNumber: expense.expenseNumber,
    category: expense.category,
    status: expense.status,
    amount: num(expense.amount),
    description: expense.description,
    paidTo: expense.paidTo,
    expenseDate: expense.expenseDate,
    branchName: expense.branch.name,
    createdBy: expense.createdBy?.name ?? null,
  }));

  const columns: Column<ExpenseRow>[] = [
    {
      key: "number",
      header: "Expense",
      cell: (row) => (
        <div className="space-y-0.5">
          <p className="font-mono text-sm font-semibold">{row.expenseNumber}</p>
          <p className="text-xs text-muted-foreground">{humanize(row.category)}</p>
        </div>
      ),
    },
    {
      key: "description",
      header: "Description",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{row.description}</p>
          {row.paidTo ? (
            <p className="truncate text-xs text-muted-foreground">to {row.paidTo}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "date",
      header: "Date",
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.expenseDate)}</span>
      ),
    },
    ...(branches.length > 1
      ? [
          {
            key: "branch",
            header: "Branch",
            hideOnMobile: true,
            cell: (row: ExpenseRow) => (
              <span className="text-sm text-muted-foreground">{row.branchName}</span>
            ),
          } satisfies Column<ExpenseRow>,
        ]
      : []),
    { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} dot /> },
    {
      key: "amount",
      header: "Amount",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <span className="text-sm font-semibold numeric">{formatCurrency(row.amount)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (row: ExpenseRow) => (
        <div className="flex items-center justify-end gap-1.5">
          {canApprove && row.status === "PENDING" ? (
            <ExpenseDecisionControls expenseId={row.id} />
          ) : null}
          {canManage ? (
            <RowActions
              compact
              remove={
                row.status === "PENDING"
                  ? {
                      subject: row.expenseNumber,
                      confirmLabel: "Withdraw expense",
                      successMessage: `${row.expenseNumber} withdrawn`,
                      impact: (
                        <p>
                          Nobody has approved this yet, so it is removed outright and never
                          reaches the profit figure.
                        </p>
                      ),
                      action: deleteExpenseAction.bind(null, { id: row.id }),
                    }
                  : undefined
              }
            />
          ) : null}
        </div>
      ),
    } satisfies Column<ExpenseRow>,
  ];

  return (
    <div className="space-y-5">
      <Header
        title="Expenses"
        description="Operating costs, approved and fed into the profit figure."
        actions={
          <>
            <Button asChild variant="outline" size="icon" aria-label="Back to settings">
              <Link href="/settings">
                <ArrowLeft />
              </Link>
            </Button>
            {canManage ? (
              <ExpenseDialog branches={branches} defaultBranchId={user.branchId} />
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard
          label="Approved spend in range"
          value={formatCurrency(totals._sum.amount ?? 0)}
          icon={Wallet}
          tone="warning"
        />
        <StatCard
          label="Awaiting approval"
          value={pendingCount}
          tone={pendingCount > 0 ? "warning" : "default"}
        />
      </div>

      <FilterBar
        searchPlaceholder="Expense number, description or payee…"
        showDateRange
        filters={[
          { name: "category", label: "Category", options: enumOptions(CATEGORIES) },
          {
            name: "status",
            label: "Status",
            options: enumOptions(["PENDING", "APPROVED", "REJECTED", "PAID"] as const),
          },
          ...(branches.length > 1
            ? [{ name: "branch", label: "Branch", options: branches }]
            : []),
        ]}
      />

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={Wallet}
            title="No expenses recorded"
            description="Rent, salaries, utilities and consumables all belong here."
          />
        }
      />
    </div>
  );
}
