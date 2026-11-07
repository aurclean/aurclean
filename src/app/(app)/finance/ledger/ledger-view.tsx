"use client";

import { useState, useTransition } from "react";
import { Search, Filter, ShieldAlert, ArrowDownLeft, ArrowUpRight, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";

import { voidLedgerAction } from "../actions";
import type { LedgerRow } from "@/lib/services/accounting";

interface Props {
  rows: LedgerRow[];
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  canManage: boolean;
}

export function LedgerView({ rows, openingBalance, totalDebit, totalCredit, closingBalance, canManage }: Props) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [selectedLedgerId, setSelectedLedgerId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [pending, startTransition] = useTransition();

  const handleOpenVoid = (id: string) => {
    setSelectedLedgerId(id);
    setVoidReason("");
    setVoidDialogOpen(true);
  };

  const handleConfirmVoid = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLedgerId || !voidReason.trim()) return;

    startTransition(async () => {
      const res = await voidLedgerAction({ ledgerId: selectedLedgerId, reason: voidReason });
      if (res.ok) {
        toast.success("Ledger entry voided & reversal entry created");
        setVoidDialogOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  };

  const filtered = rows.filter((r) => {
    const matchesCat = categoryFilter === "ALL" || r.accountCategory === categoryFilter;
    const q = search.toLowerCase().trim();
    const matchesQ =
      !q ||
      r.reference.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      (r.createdByName && r.createdByName.toLowerCase().includes(q));
    return matchesCat && matchesQ;
  });

  return (
    <div className="space-y-5">
      {/* Ledger Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-muted/20">
          <CardContent className="p-3 text-center">
            <span className="text-xs uppercase font-semibold text-muted-foreground">Opening Balance</span>
            <p className="text-xl font-bold font-mono text-foreground mt-1">{formatCurrency(openingBalance)}</p>
          </CardContent>
        </Card>

        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="p-3 text-center">
            <span className="text-xs uppercase font-semibold text-emerald-600 dark:text-emerald-400">Total Credit (In)</span>
            <p className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">+{formatCurrency(totalCredit)}</p>
          </CardContent>
        </Card>

        <Card className="border-rose-500/20 bg-rose-500/5">
          <CardContent className="p-3 text-center">
            <span className="text-xs uppercase font-semibold text-rose-600 dark:text-rose-400">Total Debit (Out)</span>
            <p className="text-xl font-bold font-mono text-rose-600 dark:text-rose-400 mt-1">-{formatCurrency(totalDebit)}</p>
          </CardContent>
        </Card>

        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-3 text-center">
            <span className="text-xs uppercase font-semibold text-primary">Closing Balance</span>
            <p className="text-xl font-bold font-mono text-primary mt-1">{formatCurrency(closingBalance)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reference (ORD-1024), customer, supplier, description..."
            className="pl-9 h-9 font-mono"
          />
        </div>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-52 h-9">
            <SelectValue placeholder="Account category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Accounts</SelectItem>
            <SelectItem value="SALES">Sales / Revenue</SelectItem>
            <SelectItem value="EXPENSE">Expense</SelectItem>
            <SelectItem value="CASH">Cash</SelectItem>
            <SelectItem value="BANK">Bank</SelectItem>
            <SelectItem value="RECEIVABLES">Receivables</SelectItem>
            <SelectItem value="PAYABLES">Payables</SelectItem>
            <SelectItem value="TRANSFER">Transfer</SelectItem>
            <SelectItem value="ADJUSTMENT">Adjustment</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Ledger Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="px-4 py-3">Date & Time</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 text-right">Debit (-)</th>
                  <th className="px-4 py-3 text-right">Credit (+)</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3 text-center">Method</th>
                  <th className="px-4 py-3">User</th>
                  {canManage && <th className="px-4 py-3 text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-muted-foreground">
                      No ledger transactions found matching filter criteria.
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => (
                    <tr
                      key={row.id}
                      className={row.isVoided ? "bg-rose-500/5 opacity-60" : "hover:bg-muted/20 transition-colors"}
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-xs font-mono">{formatDateTime(row.entryDate)}</td>
                      <td className="px-4 py-3 font-mono text-xs font-bold">
                        {row.reference}
                        {row.isVoided && <Badge tone="danger" className="ml-1.5 text-[10px]">VOIDED</Badge>}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone="neutral" className="text-[10px] font-mono">{row.accountCategory}</Badge>
                      </td>
                      <td className="px-4 py-3 font-medium text-xs">
                        {row.description}
                        {row.voidReason && <p className="text-[11px] text-rose-500">Reason: {row.voidReason}</p>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-rose-600 dark:text-rose-400 font-semibold">
                        {row.debit > 0 ? `-${formatCurrency(row.debit)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                        {row.credit > 0 ? `+${formatCurrency(row.credit)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold">
                        {formatCurrency(row.balanceAfter)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge tone="outline" className="text-[10px] font-mono">{row.paymentMethod}</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{row.createdByName || "System"}</td>
                      {canManage && (
                        <td className="px-4 py-3 text-right">
                          {!row.isVoided && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-rose-500 hover:text-rose-700"
                              onClick={() => handleOpenVoid(row.id)}
                            >
                              Void
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Void Dialog */}
      <Dialog open={voidDialogOpen} onOpenChange={setVoidDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-rose-600 flex items-center gap-2">
              <ShieldAlert className="size-5" /> Void Ledger Transaction
            </DialogTitle>
            <DialogDescription>
              Voiding creates an immutable balancing reversal entry and updates cash/bank accounts.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleConfirmVoid} className="space-y-4 my-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold">Reason for Voiding</label>
              <Input
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="e.g. Incorrect entry amount / Duplicate record"
                required
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setVoidDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={pending || !voidReason.trim()}>
                {pending ? "Voiding..." : "Confirm Void & Reverse"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
