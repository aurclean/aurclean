"use client";

import { useState, useTransition } from "react";
import { ArrowDownLeft, ArrowUpRight, Building2, Plus, RefreshCw, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";

import { transferCashBankAction } from "../actions";

interface BankOpt {
  id: string;
  bankName: string;
  accountName: string;
  currentBalance: number;
}

interface CashTxn {
  id: string;
  txnDate: string;
  type: string;
  amount: number;
  balanceAfter: number;
  reference: string | null;
  reason: string;
  createdByName: string | null;
}

interface Props {
  summary: {
    openingBalance: number;
    currentBalance: number;
    totalCashIn: number;
    totalCashOut: number;
    transactions: CashTxn[];
  };
  bankAccounts: BankOpt[];
  canManage: boolean;
}

export function CashView({ summary, bankAccounts, canManage }: Props) {
  const [transferOpen, setTransferOpen] = useState(false);
  const [direction, setDirection] = useState<"CASH_TO_BANK" | "BANK_TO_CASH">("CASH_TO_BANK");
  const [bankAccountId, setBankAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  const handleOpenTransfer = (dir: "CASH_TO_BANK" | "BANK_TO_CASH") => {
    setDirection(dir);
    setAmount("");
    setNotes("");
    if (bankAccounts.length > 0) setBankAccountId(bankAccounts[0].id);
    setTransferOpen(true);
  };

  const handleTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmt = parseFloat(amount);
    if (isNaN(numAmt) || numAmt <= 0) {
      toast.error("Please enter a valid transfer amount");
      return;
    }
    if (!bankAccountId) {
      toast.error("Please select a bank account");
      return;
    }

    startTransition(async () => {
      const res = await transferCashBankAction({
        bankAccountId,
        amount: numAmt,
        direction,
        notes,
      });

      if (res.ok) {
        toast.success(`Transfer completed (Ref: ${res.data.reference})`);
        setTransferOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Cash Counter Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-muted/20">
          <CardContent className="p-3.5 text-center">
            <span className="text-xs uppercase font-semibold text-muted-foreground">Opening Cash</span>
            <p className="text-2xl font-bold font-mono text-foreground mt-1">{formatCurrency(summary.openingBalance)}</p>
          </CardContent>
        </Card>

        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-3.5 text-center">
            <span className="text-xs uppercase font-semibold text-emerald-600 dark:text-emerald-400">Total Cash Received</span>
            <p className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">+{formatCurrency(summary.totalCashIn)}</p>
          </CardContent>
        </Card>

        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardContent className="p-3.5 text-center">
            <span className="text-xs uppercase font-semibold text-rose-600 dark:text-rose-400">Total Cash Paid</span>
            <p className="text-2xl font-bold font-mono text-rose-600 dark:text-rose-400 mt-1">-{formatCurrency(summary.totalCashOut)}</p>
          </CardContent>
        </Card>

        <Card className="border-emerald-600/40 bg-emerald-600/10">
          <CardContent className="p-3.5 text-center">
            <span className="text-xs uppercase font-semibold text-emerald-700 dark:text-emerald-300">Current Cash in Hand</span>
            <p className="text-2xl font-extrabold font-mono text-emerald-700 dark:text-emerald-300 mt-1">{formatCurrency(summary.currentBalance)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Transfer Controls */}
      {canManage && (
        <div className="flex flex-wrap items-center gap-3 bg-muted/30 p-3 rounded-xl border">
          <span className="text-xs font-semibold text-muted-foreground uppercase">Counter Cash Transfers:</span>
          <Button size="sm" onClick={() => handleOpenTransfer("CASH_TO_BANK")} className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700">
            <ArrowUpRight className="size-4" /> Deposit Cash into Bank
          </Button>
          <Button size="sm" variant="outline" onClick={() => handleOpenTransfer("BANK_TO_CASH")} className="gap-1.5">
            <ArrowDownLeft className="size-4" /> Withdraw Cash from Bank
          </Button>
        </div>
      )}

      {/* Cash Transactions Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Wallet className="size-4 text-emerald-600" /> Cash Register Transaction Journal
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="px-4 py-3">Date & Time</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Reason / Description</th>
                  <th className="px-4 py-3">Cashier</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Running Cash</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {summary.transactions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted-foreground">
                      No cash register transactions recorded yet.
                    </td>
                  </tr>
                ) : (
                  summary.transactions.map((t) => (
                    <tr key={t.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 text-xs font-mono">{formatDateTime(t.txnDate)}</td>
                      <td className="px-4 py-3 font-mono font-bold text-xs">{t.reference || "—"}</td>
                      <td className="px-4 py-3">
                        <Badge tone={t.type.includes("IN") || t.type.includes("WITHDRAWAL") ? "success" : "danger"} className="text-[10px]">
                          {t.type.replace(/_/g, " ")}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-medium text-xs">{t.reason}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{t.createdByName || "Counter"}</td>
                      <td className={`px-4 py-3 text-right font-mono font-bold ${
                        t.type.includes("IN") || t.type.includes("WITHDRAWAL") ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                      }`}>
                        {t.type.includes("IN") || t.type.includes("WITHDRAWAL") ? `+${formatCurrency(t.amount)}` : `-${formatCurrency(t.amount)}`}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold">
                        {formatCurrency(t.balanceAfter)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Cash <-> Bank Transfer Dialog */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="size-5 text-primary" />
              {direction === "CASH_TO_BANK" ? "Deposit Cash into Bank" : "Withdraw Cash from Bank"}
            </DialogTitle>
            <DialogDescription>
              Transfers between Cash in Hand and Bank accounts (Linked Ref TRF-XXXXXX).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleTransfer} className="space-y-4 my-2">
            <div className="space-y-1.5">
              <Label>Bank Account</Label>
              <Select value={bankAccountId} onValueChange={setBankAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Account" />
                </SelectTrigger>
                <SelectContent>
                  {bankAccounts.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.bankName} ({b.accountName}) — Available: {formatCurrency(b.currentBalance)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Transfer Amount (₹)</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="5000.00"
                className="font-mono text-base"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>Notes / Slip Reference (Optional)</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Daily cash counter deposit slip #42"
              />
            </div>

            <DialogFooter className="pt-3">
              <Button type="button" variant="outline" onClick={() => setTransferOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending} className="bg-primary text-primary-foreground font-semibold">
                {pending ? "Processing Transfer..." : "Complete Transfer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
