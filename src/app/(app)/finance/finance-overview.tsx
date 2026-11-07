"use client";

import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Building2,
  Calendar,
  CreditCard,
  DollarSign,
  FileSpreadsheet,
  Layers,
  Receipt,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/money";
import type { FinancialOverviewMetrics } from "@/lib/services/accounting";

interface Props {
  metrics: FinancialOverviewMetrics;
}

export function FinanceOverviewView({ metrics }: Props) {
  return (
    <div className="space-y-6">
      {/* Real-time Headline Cash & Balance Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/finance/cash" className="group">
          <Card className="h-full border-emerald-500/30 bg-emerald-500/5 transition-all hover:border-emerald-500/60 hover:shadow-md">
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-emerald-600 dark:text-emerald-400">
                Cash in Hand
              </CardTitle>
              <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Wallet className="size-4" />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                {formatCurrency(metrics.cashInHand)}
              </p>
              <p className="text-xs text-muted-foreground mt-1 group-hover:underline">
                View physical cash register & adjustments →
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/finance/bank-accounts" className="group">
          <Card className="h-full border-info/30 bg-info/5 transition-all hover:border-info/60 hover:shadow-md">
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-info">
                Bank Balance
              </CardTitle>
              <div className="flex size-8 items-center justify-center rounded-lg bg-info/10 text-info">
                <Building2 className="size-4" />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold font-mono text-info">
                {formatCurrency(metrics.bankBalance)}
              </p>
              <p className="text-xs text-muted-foreground mt-1 group-hover:underline">
                View bank accounts & statements →
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/finance/receivables" className="group">
          <Card className="h-full border-amber-500/30 bg-amber-500/5 transition-all hover:border-amber-500/60 hover:shadow-md">
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-amber-600 dark:text-amber-400">
                Customer Receivables
              </CardTitle>
              <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <ArrowDownLeft className="size-4" />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">
                {formatCurrency(metrics.customerReceivables)}
              </p>
              <p className="text-xs text-muted-foreground mt-1 group-hover:underline">
                View customer balances & collect →
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/finance/payables" className="group">
          <Card className="h-full border-rose-500/30 bg-rose-500/5 transition-all hover:border-rose-500/60 hover:shadow-md">
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-rose-600 dark:text-rose-400">
                Supplier Payables
              </CardTitle>
              <div className="flex size-8 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
                <ArrowUpRight className="size-4" />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold font-mono text-rose-600 dark:text-rose-400">
                {formatCurrency(metrics.supplierPayables)}
              </p>
              <p className="text-xs text-muted-foreground mt-1 group-hover:underline">
                View supplier invoices & pay →
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Today's Financial Activity */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Calendar className="size-4 text-primary" /> Today&apos;s Cash Flow Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
            <Link href="/finance/incoming" className="p-4 rounded-xl border bg-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40 transition">
              <span className="text-xs font-semibold uppercase text-emerald-600 dark:text-emerald-400 flex items-center justify-center gap-1">
                <ArrowDownLeft className="size-3.5" /> Today&apos;s Incoming
              </span>
              <p className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-2">
                {formatCurrency(metrics.todayIncoming)}
              </p>
            </Link>

            <Link href="/finance/outgoing" className="p-4 rounded-xl border bg-rose-500/5 border-rose-500/20 hover:border-rose-500/40 transition">
              <span className="text-xs font-semibold uppercase text-rose-600 dark:text-rose-400 flex items-center justify-center gap-1">
                <ArrowUpRight className="size-3.5" /> Today&apos;s Outgoing
              </span>
              <p className="text-2xl font-bold font-mono text-rose-600 dark:text-rose-400 mt-2">
                {formatCurrency(metrics.todayOutgoing)}
              </p>
            </Link>

            <div className="p-4 rounded-xl border bg-primary/5 border-primary/20">
              <span className="text-xs font-semibold uppercase text-primary flex items-center justify-center gap-1">
                <TrendingUp className="size-3.5" /> Today&apos;s Net Flow
              </span>
              <p className="text-2xl font-bold font-mono text-primary mt-2">
                {formatCurrency(metrics.netToday)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Access Financial Modules Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="hover:border-primary/40 transition">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FileSpreadsheet className="size-4 text-primary" /> Central Business Ledger
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Complete transaction journal with debits, credits, running balances and audit trails.
            </p>
            <Button asChild size="sm" variant="outline" className="w-full">
              <Link href="/finance/ledger">Open Ledger →</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:border-primary/40 transition">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="size-4 text-primary" /> Financial Reports & P&L
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Real profit & loss statements, cash flow analysis, and balance summaries.
            </p>
            <Button asChild size="sm" variant="outline" className="w-full">
              <Link href="/finance/reports">View P&L & Reports →</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:border-primary/40 transition">
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Layers className="size-4 text-primary" /> Cash & Bank Reconciliation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Reconcile physical cash and bank statement balances against ERP ledgers.
            </p>
            <Button asChild size="sm" variant="outline" className="w-full">
              <Link href="/finance/reconciliation">Open Reconciliation →</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
