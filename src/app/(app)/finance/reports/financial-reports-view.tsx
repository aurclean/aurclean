"use client";

import { useState } from "react";
import { FileSpreadsheet, TrendingUp, TrendingDown, DollarSign, ArrowDownLeft, ArrowUpRight, Scale } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency } from "@/lib/money";

interface Props {
  pnl: {
    salesRevenue: number;
    otherIncome: number;
    grossRevenue: number;
    cogsPurchases: number;
    operatingExpenses: number;
    expenseBreakdown: Array<{ category: string; amount: number }>;
    totalExpenses: number;
    netProfit: number;
  };
  metrics: {
    cashInHand: number;
    bankBalance: number;
    customerReceivables: number;
    supplierPayables: number;
  };
}

export function FinancialReportsView({ pnl, metrics }: Props) {
  const totalAssets = metrics.cashInHand + metrics.bankBalance + metrics.customerReceivables;
  const totalLiabilities = metrics.supplierPayables;
  const netEquity = totalAssets - totalLiabilities;

  return (
    <div className="space-y-6">
      <Tabs defaultValue="pnl" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 max-w-lg h-11 p-1 bg-muted/60">
          <TabsTrigger value="pnl" className="gap-2 font-medium">
            <TrendingUp className="size-4" /> Profit & Loss
          </TabsTrigger>
          <TabsTrigger value="cashflow" className="gap-2 font-medium">
            <DollarSign className="size-4" /> Cash Flow
          </TabsTrigger>
          <TabsTrigger value="balance" className="gap-2 font-medium">
            <Scale className="size-4" /> Financial Summary
          </TabsTrigger>
        </TabsList>

        {/* 1. PROFIT & LOSS REPORT */}
        <TabsContent value="pnl" className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="border-emerald-500/30 bg-emerald-500/5">
              <CardContent className="p-4">
                <span className="text-xs uppercase font-semibold text-emerald-600 dark:text-emerald-400">Gross Revenue</span>
                <p className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                  {formatCurrency(pnl.grossRevenue)}
                </p>
              </CardContent>
            </Card>

            <Card className="border-rose-500/30 bg-rose-500/5">
              <CardContent className="p-4">
                <span className="text-xs uppercase font-semibold text-rose-600 dark:text-rose-400">Total Costs & Expenses</span>
                <p className="text-2xl font-bold font-mono text-rose-600 dark:text-rose-400 mt-1">
                  {formatCurrency(pnl.totalExpenses)}
                </p>
              </CardContent>
            </Card>

            <Card className={pnl.netProfit >= 0 ? "border-emerald-600/40 bg-emerald-600/10" : "border-rose-600/40 bg-rose-600/10"}>
              <CardContent className="p-4">
                <span className="text-xs uppercase font-semibold text-primary">Net Operating Profit</span>
                <p className={`text-2xl font-extrabold font-mono mt-1 ${pnl.netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                  {formatCurrency(pnl.netProfit)}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <FileSpreadsheet className="size-4 text-primary" /> Statement of Profit & Loss
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 font-mono text-sm">
                <div className="flex justify-between py-2 border-b font-bold text-foreground">
                  <span>INCOME / REVENUE</span>
                  <span></span>
                </div>
                <div className="flex justify-between pl-4 text-muted-foreground">
                  <span>Laundry Sales Revenue</span>
                  <span>{formatCurrency(pnl.salesRevenue)}</span>
                </div>
                <div className="flex justify-between pl-4 text-muted-foreground">
                  <span>Other Income</span>
                  <span>{formatCurrency(pnl.otherIncome)}</span>
                </div>
                <div className="flex justify-between py-2 border-t font-semibold text-emerald-600 dark:text-emerald-400">
                  <span>Total Gross Income</span>
                  <span>{formatCurrency(pnl.grossRevenue)}</span>
                </div>

                <div className="flex justify-between py-2 border-b font-bold text-foreground mt-4">
                  <span>EXPENSES & COST OF GOODS</span>
                  <span></span>
                </div>
                <div className="flex justify-between pl-4 text-muted-foreground">
                  <span>Consumable Purchases (COGS)</span>
                  <span>{formatCurrency(pnl.cogsPurchases)}</span>
                </div>
                {pnl.expenseBreakdown.map((exp) => (
                  <div key={exp.category} className="flex justify-between pl-4 text-muted-foreground text-xs">
                    <span>Operating Expense — {exp.category}</span>
                    <span>{formatCurrency(exp.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between py-2 border-t font-semibold text-rose-600 dark:text-rose-400">
                  <span>Total Operating Costs</span>
                  <span>-{formatCurrency(pnl.totalExpenses)}</span>
                </div>

                <div className="flex justify-between py-3 border-t-2 border-b-2 font-extrabold text-base mt-4 bg-muted/20 px-2">
                  <span>NET OPERATING PROFIT</span>
                  <span className={pnl.netProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                    {formatCurrency(pnl.netProfit)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 2. CASH FLOW REPORT */}
        <TabsContent value="cashflow" className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <DollarSign className="size-4 text-primary" /> Cash Flow Statement
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border bg-emerald-500/5 space-y-2">
                  <span className="text-xs uppercase font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <ArrowDownLeft className="size-4" /> Operating Cash Inflow
                  </span>
                  <p className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(pnl.salesRevenue)}
                  </p>
                  <p className="text-xs text-muted-foreground">Cash & digital receipts collected from customers</p>
                </div>

                <div className="p-4 rounded-xl border bg-rose-500/5 space-y-2">
                  <span className="text-xs uppercase font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                    <ArrowUpRight className="size-4" /> Operating Cash Outflow
                  </span>
                  <p className="text-2xl font-bold font-mono text-rose-600 dark:text-rose-400">
                    {formatCurrency(pnl.totalExpenses)}
                  </p>
                  <p className="text-xs text-muted-foreground">Operating expenses & supplier disbursements</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 3. FINANCIAL BALANCE SUMMARY */}
        <TabsContent value="balance" className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                  <Scale className="size-4" /> Current Business Assets
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 font-mono text-sm">
                <div className="flex justify-between border-b pb-2">
                  <span>Cash in Hand:</span>
                  <span className="font-bold">{formatCurrency(metrics.cashInHand)}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span>Bank Accounts Balance:</span>
                  <span className="font-bold">{formatCurrency(metrics.bankBalance)}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span>Customer Receivables:</span>
                  <span className="font-bold">{formatCurrency(metrics.customerReceivables)}</span>
                </div>
                <div className="flex justify-between pt-2 text-base font-extrabold text-emerald-600 dark:text-emerald-400">
                  <span>Total Assets:</span>
                  <span>{formatCurrency(totalAssets)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base font-bold text-rose-600 dark:text-rose-400 flex items-center gap-2">
                  <Scale className="size-4" /> Current Business Liabilities
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 font-mono text-sm">
                <div className="flex justify-between border-b pb-2">
                  <span>Supplier Payables:</span>
                  <span className="font-bold text-rose-600 dark:text-rose-400">{formatCurrency(metrics.supplierPayables)}</span>
                </div>
                <div className="flex justify-between pt-2 text-base font-extrabold text-rose-600 dark:text-rose-400">
                  <span>Total Liabilities:</span>
                  <span>{formatCurrency(totalLiabilities)}</span>
                </div>
                <div className="flex justify-between pt-6 border-t font-extrabold text-base text-primary">
                  <span>Net Working Equity:</span>
                  <span>{formatCurrency(netEquity)}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
