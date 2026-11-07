"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Layers, Plus, RefreshCw, Scale } from "lucide-react";
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

import { submitReconciliationAction } from "../actions";

interface BankOpt {
  id: string;
  bankName: string;
  accountName: string;
  currentBalance: number;
}

interface RecRow {
  id: string;
  type: string;
  bankName: string;
  reconciledDate: string;
  expectedBalance: number;
  actualBalance: number;
  difference: number;
  adjustmentNotes: string;
  createdByName: string | null;
}

interface Props {
  reconciliations: RecRow[];
  bankAccounts: BankOpt[];
  cashCurrentBalance: number;
  canManage: boolean;
}

export function ReconciliationView({ reconciliations, bankAccounts, cashCurrentBalance, canManage }: Props) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"CASH" | "BANK">("CASH");
  const [bankAccountId, setBankAccountId] = useState("");
  const [actualBalance, setActualBalance] = useState("");
  const [adjustmentNotes, setAdjustmentNotes] = useState("");
  const [pending, startTransition] = useTransition();

  const handleOpenModal = (t: "CASH" | "BANK") => {
    setType(t);
    setActualBalance("");
    setAdjustmentNotes("");
    if (t === "BANK" && bankAccounts.length > 0) setBankAccountId(bankAccounts[0].id);
    setOpen(true);
  };

  const expectedVal =
    type === "CASH"
      ? cashCurrentBalance
      : bankAccounts.find((b) => b.id === bankAccountId)?.currentBalance ?? 0;

  const actualVal = parseFloat(actualBalance) || 0;
  const diffVal = actualVal - expectedVal;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustmentNotes.trim()) {
      toast.error("Adjustment notes / explanation required for reconciliation");
      return;
    }

    startTransition(async () => {
      const res = await submitReconciliationAction({
        type,
        bankAccountId: type === "BANK" ? bankAccountId : undefined,
        expectedBalance: expectedVal,
        actualBalance: actualVal,
        adjustmentNotes,
      });

      if (res.ok) {
        toast.success("Reconciliation adjustment recorded");
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Actions */}
      {canManage && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => handleOpenModal("CASH")} className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
            <Scale className="size-4" /> Reconcile Cash Register
          </Button>
          <Button onClick={() => handleOpenModal("BANK")} variant="outline" className="gap-2 border-blue-500/40 text-blue-600 dark:text-blue-400">
            <Scale className="size-4" /> Reconcile Bank Statement
          </Button>
        </div>
      )}

      {/* History Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Layers className="size-4 text-primary" /> Reconciliation Audit Trail
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="px-4 py-3">Date & Time</th>
                  <th className="px-4 py-3">Account Reconciled</th>
                  <th className="px-4 py-3 text-right">Expected Balance</th>
                  <th className="px-4 py-3 text-right">Actual Counted</th>
                  <th className="px-4 py-3 text-right">Difference</th>
                  <th className="px-4 py-3">Adjustment Notes</th>
                  <th className="px-4 py-3">User</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {reconciliations.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted-foreground">
                      No reconciliation adjustments recorded yet.
                    </td>
                  </tr>
                ) : (
                  reconciliations.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 text-xs font-mono">{formatDateTime(r.reconciledDate)}</td>
                      <td className="px-4 py-3 font-semibold text-xs">{r.bankName}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{formatCurrency(r.expectedBalance)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-bold">{formatCurrency(r.actualBalance)}</td>
                      <td className={`px-4 py-3 text-right font-mono font-bold ${
                        r.difference === 0 ? "text-muted-foreground" : r.difference > 0 ? "text-emerald-600" : "text-rose-600"
                      }`}>
                        {r.difference > 0 ? `+${formatCurrency(r.difference)}` : formatCurrency(r.difference)}
                      </td>
                      <td className="px-4 py-3 font-medium text-xs">{r.adjustmentNotes}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{r.createdByName || "Manager"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="size-5 text-primary" /> {type === "CASH" ? "Reconcile Physical Cash Drawer" : "Reconcile Bank Statement"}
            </DialogTitle>
            <DialogDescription>
              Compares actual counted physical balance against current ERP ledger balance.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 my-2">
            {type === "BANK" && (
              <div className="space-y-1.5">
                <Label>Select Bank Account</Label>
                <Select value={bankAccountId} onValueChange={setBankAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select Bank Account" />
                  </SelectTrigger>
                  <SelectContent>
                    {bankAccounts.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.bankName} ({b.accountName})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="rounded-lg bg-muted/40 p-3 space-y-1 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-muted-foreground">ERP Ledger Expected Balance:</span>
                <span className="font-bold">{formatCurrency(expectedVal)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Calculated Discrepancy:</span>
                <span className={diffVal === 0 ? "text-muted-foreground font-bold" : diffVal > 0 ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"}>
                  {diffVal > 0 ? `+${formatCurrency(diffVal)}` : formatCurrency(diffVal)}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Actual Counted / Statement Balance (₹)</Label>
              <Input
                type="number"
                step="0.01"
                value={actualBalance}
                onChange={(e) => setActualBalance(e.target.value)}
                placeholder="e.g. 25400.00"
                className="font-mono text-base"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>Adjustment Reason / Audit Notes</Label>
              <Input
                value={adjustmentNotes}
                onChange={(e) => setAdjustmentNotes(e.target.value)}
                placeholder="e.g. Verified against bank statement #1042 / Cash audit count match"
                required
              />
            </div>

            <DialogFooter className="pt-3">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending} className="bg-primary text-primary-foreground font-semibold">
                {pending ? "Saving..." : "Record Reconciliation"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
