"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ExternalLink, Search, Truck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/money";

interface SupplierPayable {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  totalInvoices: number;
  totalPurchased: number;
  totalPaid: number;
  outstandingPayable: number;
}

interface Props {
  suppliers: SupplierPayable[];
}

export function PayablesView({ suppliers }: Props) {
  const [search, setSearch] = useState("");

  const payables = suppliers.filter((s) => s.outstandingPayable > 0);
  const filtered = payables.filter(
    (s) =>
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.code.toLowerCase().includes(search.toLowerCase()),
  );

  const totalPayables = payables.reduce((sum, s) => sum + s.outstandingPayable, 0);

  return (
    <div className="space-y-5">
      {/* Header Summary */}
      <Card className="border-rose-500/30 bg-rose-500/5">
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <span className="text-xs uppercase font-semibold text-rose-600 dark:text-rose-400">Total Supplier Payables</span>
            <p className="text-3xl font-extrabold font-mono text-rose-600 dark:text-rose-400 mt-1">
              {formatCurrency(totalPayables)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{payables.length} suppliers with outstanding invoices</p>
          </div>
          <div className="flex size-12 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
            <ArrowUpRight className="size-6" />
          </div>
        </CardContent>
      </Card>

      {/* Search */}
      <div className="relative w-full">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search supplier by name or code..."
          className="pl-9 h-9"
        />
      </div>

      {/* Payables Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="px-4 py-3">Supplier Code</th>
                  <th className="px-4 py-3">Supplier Name</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3 text-right">Total Purchases</th>
                  <th className="px-4 py-3 text-right">Amount Paid</th>
                  <th className="px-4 py-3 text-right">Outstanding Payable</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted-foreground">
                      No supplier payables due. All invoices cleared!
                    </td>
                  </tr>
                ) : (
                  filtered.map((s) => (
                    <tr key={s.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs font-bold">{s.code}</td>
                      <td className="px-4 py-3 font-semibold text-foreground">{s.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{s.phone || "—"}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{formatCurrency(s.totalPurchased)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-emerald-600">{formatCurrency(s.totalPaid)}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                        {formatCurrency(s.outstandingPayable)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button asChild size="sm" variant="outline" className="gap-1.5 text-xs">
                          <Link href={`/purchases/suppliers/${s.id}`}>
                            View Ledger & Pay <ExternalLink className="size-3" />
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
