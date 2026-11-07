"use client";

import { useState, useTransition } from "react";
import { ArrowUpRight, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";

import { recordOutgoingMoneyAction } from "../actions";
import type { LedgerRow } from "@/lib/services/accounting";

interface BankOpt {
  id: string;
  bankName: string;
  accountName: string;
}

interface Props {
  rows: LedgerRow[];
  bankAccounts: BankOpt[];
  canManage: boolean;
}

const OUTGOING_CATEGORIES = [
  { value: "RENT", label: "Rent" },
  { value: "SALARY", label: "Salary / Wages" },
  { value: "UTILITIES", label: "Electricity & Water" },
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "TRANSPORT", label: "Transport & Fuel" },
  { value: "CONSUMABLES", label: "Laundry Supplies" },
  { value: "MARKETING", label: "Marketing" },
  { value: "MISCELLANEOUS", label: "Other Expenses" },
];

export function OutgoingView({ rows, bankAccounts, canManage }: Props) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const [category, setCategory] = useState<any>("MISCELLANEOUS");
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [bankAccountId, setBankAccountId] = useState("");
  const [description, setDescription] = useState("");

  const [pending, startTransition] = useTransition();

  const handleOpenModal = () => {
    setCategory("MISCELLANEOUS");
    setAmount("");
    setPayee("");
    setPaymentMethod("CASH");
    setBankAccountId("");
    setDescription("");
    setOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmt = parseFloat(amount);
    if (isNaN(numAmt) || numAmt <= 0) {
      toast.error("Please enter a valid outgoing amount");
      return;
    }
    if (!description.trim()) {
      toast.error("Description is required");
      return;
    }

    startTransition(async () => {
      const res = await recordOutgoingMoneyAction({
        category,
        amount: numAmt,
        payee,
        paymentMethod,
        bankAccountId: paymentMethod !== "CASH" ? bankAccountId : undefined,
        description,
      });

      if (res.ok) {
        toast.success(`Outgoing payment recorded (Ref: ${res.data.reference})`);
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  };

  // Filter outgoing transactions (Debit > 0)
  const outgoingRows = rows.filter((r) => r.debit > 0);
  const filtered = outgoingRows.filter((r) => {
    const q = search.toLowerCase().trim();
    return !q || r.reference.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
  });

  const totalOutgoing = outgoingRows.reduce((sum, r) => sum + r.debit, 0);

  return (
    <div className="space-y-5">
      {/* Total Card */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <Card className="flex-1 border-rose-500/30 bg-rose-500/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs uppercase font-semibold text-rose-600 dark:text-rose-400">Total Outgoing Payments</span>
              <p className="text-3xl font-extrabold font-mono text-rose-600 dark:text-rose-400 mt-1">
                {formatCurrency(totalOutgoing)}
              </p>
            </div>
            <div className="flex size-12 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
              <ArrowUpRight className="size-6" />
            </div>
          </CardContent>
        </Card>

        {canManage && (
          <Button onClick={handleOpenModal} size="lg" className="gap-2 bg-rose-600 text-white hover:bg-rose-700 font-semibold shrink-0">
            <Plus className="size-4" /> Record Outgoing Payment
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative w-full">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search outgoing payments by reference, payee, description..."
          className="pl-9 h-9"
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="px-4 py-3">Date & Time</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Category / Account</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3 text-right">Amount Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-muted-foreground">
                      No outgoing payments recorded yet.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 text-xs font-mono">{formatDateTime(r.entryDate)}</td>
                      <td className="px-4 py-3 font-mono font-bold text-xs">{r.reference}</td>
                      <td className="px-4 py-3">
                        <Badge tone="neutral" className="text-[10px] font-mono">{r.accountCategory}</Badge>
                      </td>
                      <td className="px-4 py-3 font-medium text-xs">{r.description}</td>
                      <td className="px-4 py-3">
                        <Badge tone="outline" className="text-[10px] font-mono">{r.paymentMethod}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                        -{formatCurrency(r.debit)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Record Outgoing Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600">
              <ArrowUpRight className="size-5" /> Record Outgoing Payment
            </DialogTitle>
            <DialogDescription>
              Record business expenses, supplier disbursements, salaries or bill payments.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4 my-2">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Category" />
                </SelectTrigger>
                <SelectContent>
                  {OUTGOING_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount (₹)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="500.00"
                  className="font-mono text-base"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label>Payee (Optional)</Label>
                <Input
                  value={payee}
                  onChange={(e) => setPayee(e.target.value)}
                  placeholder="e.g. ABC Detergents Ltd"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Monthly laundry detergent supplies"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">Cash in Hand</SelectItem>
                  <SelectItem value="UPI">UPI</SelectItem>
                  <SelectItem value="CARD">Credit / Debit Card</SelectItem>
                  <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                  <SelectItem value="ONLINE">Online</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {paymentMethod !== "CASH" && (
              <div className="space-y-1.5">
                <Label>Source Bank Account</Label>
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

            <DialogFooter className="pt-3">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending} className="bg-rose-600 text-white hover:bg-rose-700 font-semibold">
                {pending ? "Recording..." : "Record Outgoing Payment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
