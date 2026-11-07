"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ExternalLink, Search, UserCheck, Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/money";

interface CustomerReceivable {
  id: string;
  name: string;
  phone: string;
  orderCount: number;
  totalSpent: number;
  outstandingAmount: number;
}

interface Props {
  customers: CustomerReceivable[];
}

export function ReceivablesView({ customers }: Props) {
  const [search, setSearch] = useState("");

  const debtors = customers.filter((c) => c.outstandingAmount > 0);
  const filtered = debtors.filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.toLowerCase().includes(search.toLowerCase()),
  );

  const totalOutstanding = debtors.reduce((sum, c) => sum + c.outstandingAmount, 0);

  return (
    <div className="space-y-5">
      {/* Header Summary */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <span className="text-xs uppercase font-semibold text-amber-600 dark:text-amber-400">Total Customer Receivables</span>
            <p className="text-3xl font-extrabold font-mono text-amber-600 dark:text-amber-400 mt-1">
              {formatCurrency(totalOutstanding)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{debtors.length} customers with outstanding balances</p>
          </div>
          <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <ArrowDownLeft className="size-6" />
          </div>
        </CardContent>
      </Card>

      {/* Search */}
      <div className="relative w-full">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer by name or phone..."
          className="pl-9 h-9"
        />
      </div>

      {/* Receivables Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="px-4 py-3">Customer Name</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3 text-center">Total Orders</th>
                  <th className="px-4 py-3 text-right">Lifetime Spent</th>
                  <th className="px-4 py-3 text-right">Outstanding Due</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-muted-foreground">
                      No customer outstanding balances found. All accounts clear!
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => (
                    <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-semibold text-foreground">{c.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c.phone}</td>
                      <td className="px-4 py-3 text-center font-mono text-xs">{c.orderCount}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{formatCurrency(c.totalSpent)}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                        {formatCurrency(c.outstandingAmount)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button asChild size="sm" variant="outline" className="gap-1.5 text-xs">
                          <Link href={`/customers/${c.id}`}>
                            View Ledger & Collect <ExternalLink className="size-3" />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
