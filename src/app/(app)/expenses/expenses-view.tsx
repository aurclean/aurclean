"use client";

import { useState, useTransition } from "react";
import { Plus, Search, Trash2, Edit, Receipt, Wallet, DollarSign, Calendar, FileText } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";

import { saveExpenseAction, deleteExpenseAction } from "./actions";
import type { ExpenseRow } from "@/lib/services/expenses";

const CATEGORY_LABELS: Record<string, string> = {
  RENT: "Rent",
  SALARY: "Salary / Wages",
  UTILITIES: "Electricity & Water",
  MAINTENANCE: "Equipment Maintenance",
  TRANSPORT: "Transport & Fuel",
  CONSUMABLES: "Laundry Supplies & Chemicals",
  MARKETING: "Marketing & Ads",
  MISCELLANEOUS: "Other Business Expenses",
};

interface Props {
  expenses: ExpenseRow[];
  monthlyTotal: number;
  categoryTotals: Record<string, number>;
  canManage: boolean;
}

export function ExpensesView({ expenses, monthlyTotal, categoryTotals, canManage }: Props) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);

  const [category, setCategory] = useState<string>("MISCELLANEOUS");
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [paidTo, setPaidTo] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<string>("CASH");
  const [reference, setReference] = useState<string>("");
  const [expenseDate, setExpenseDate] = useState<string>(new Date().toISOString().slice(0, 10));

  const [pending, startTransition] = useTransition();

  const handleOpenAdd = () => {
    setEditing(null);
    setCategory("MISCELLANEOUS");
    setAmount("");
    setDescription("");
    setPaidTo("");
    setPaymentMethod("CASH");
    setReference("");
    setExpenseDate(new Date().toISOString().slice(0, 10));
    setOpen(true);
  };

  const handleOpenEdit = (item: ExpenseRow) => {
    setEditing(item);
    setCategory(item.category);
    setAmount(item.amount.toString());
    setDescription(item.description);
    setPaidTo(item.paidTo || "");
    setPaymentMethod(item.paymentMethod);
    setReference(item.reference || "");
    setExpenseDate(item.expenseDate.slice(0, 10));
    setOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.error("Please enter a valid expense amount");
      return;
    }
    if (!description.trim()) {
      toast.error("Description is required");
      return;
    }

    startTransition(async () => {
      const res = await saveExpenseAction({
        id: editing?.id,
        category,
        amount: numAmount,
        description,
        paidTo,
        paymentMethod,
        reference,
        expenseDate: new Date(expenseDate),
      });

      if (res.ok) {
        toast.success(editing ? "Expense record updated" : "Expense added successfully");
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Are you sure you want to delete this expense record?")) return;
    startTransition(async () => {
      const res = await deleteExpenseAction(id);
      if (res.ok) {
        toast.success("Expense record deleted");
      } else {
        toast.error(res.error);
      }
    });
  };

  const filtered = expenses.filter((e) => {
    const matchesCategory = categoryFilter === "ALL" || e.category === categoryFilter;
    const q = search.toLowerCase().trim();
    const matchesSearch =
      !q ||
      e.description.toLowerCase().includes(q) ||
      e.expenseNumber.toLowerCase().includes(q) ||
      (e.paidTo && e.paidTo.toLowerCase().includes(q));
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Monthly Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-rose-500/20 bg-rose-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-rose-600 dark:text-rose-400 flex items-center justify-between">
              This Month Total Expenses <Wallet className="size-4" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-extrabold font-mono text-rose-600 dark:text-rose-400">
              {formatCurrency(monthlyTotal)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Sum of all recorded operating expenses</p>
          </CardContent>
        </Card>

        <Card className="md:col-span-2 border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">
              Expense Category Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {Object.keys(CATEGORY_LABELS).map((cat) => {
              const val = categoryTotals[cat] || 0;
              return (
                <div key={cat} className="flex items-center gap-1.5 rounded-lg border bg-muted/30 px-3 py-1.5 text-xs">
                  <span className="font-medium text-foreground">{CATEGORY_LABELS[cat]}:</span>
                  <span className="font-mono font-bold">{formatCurrency(val)}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Filters and Actions */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex flex-1 items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search expenses..."
              className="pl-9 h-9"
            />
          </div>

          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-48 h-9">
              <SelectValue placeholder="Category filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Categories</SelectItem>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {canManage && (
          <Button onClick={handleOpenAdd} className="gap-2 bg-primary text-primary-foreground font-semibold">
            <Plus className="size-4" /> Add Expense
          </Button>
        )}
      </div>

      {/* Expenses Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="px-4 py-3">Expense #</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Paid To</th>
                  <th className="px-4 py-3">Payment Method</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  {canManage && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-muted-foreground">
                      No expense records found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs font-semibold">{item.expenseNumber}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs">{formatDate(item.expenseDate)}</td>
                      <td className="px-4 py-3">
                        <Badge tone="outline" className="text-[11px] font-normal">
                          {CATEGORY_LABELS[item.category] || item.category}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-medium">{item.description}</td>
                      <td className="px-4 py-3 text-muted-foreground">{item.paidTo || "—"}</td>
                      <td className="px-4 py-3">
                        <Badge tone="neutral" className="text-[11px] font-mono">
                          {item.paymentMethod}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                        {formatCurrency(item.amount)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <a
                            href={`/api/documents/pdf?type=EXPENSE_RECEIPT&id=${item.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Download PDF Receipt"
                            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <FileText className="size-3.5 text-emerald-700" />
                          </a>
                          {canManage && (
                            <>
                              <Button variant="ghost" size="icon" className="size-8" onClick={() => handleOpenEdit(item)}>
                                <Edit className="size-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => handleDelete(item.id)}>
                                <Trash2 className="size-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Add / Edit Expense Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Expense Record" : "Record New Business Expense"}</DialogTitle>
            <DialogDescription>
              Track operating costs such as rent, electricity, salaries, or laundry supplies.
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
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
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
                  placeholder="2500.00"
                  className="font-mono"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label>Expense Date</Label>
                <Input
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Electricity bill payment for Main Processing Plant"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Paid To (Recipient)</Label>
                <Input
                  value={paidTo}
                  onChange={(e) => setPaidTo(e.target.value)}
                  placeholder="e.g. Power Corp Ltd"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Payment Method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select Method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">Cash</SelectItem>
                    <SelectItem value="UPI">UPI</SelectItem>
                    <SelectItem value="CARD">Card</SelectItem>
                    <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                    <SelectItem value="ONLINE">Online</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Reference / Bill # (Optional)</Label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. TXN987654321"
                className="font-mono text-xs"
              />
            </div>

            <DialogFooter className="pt-3">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending} className="bg-primary text-primary-foreground font-semibold">
                {pending ? "Saving..." : editing ? "Update Expense" : "Save Expense"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
