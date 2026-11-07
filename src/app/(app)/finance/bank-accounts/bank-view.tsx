"use client";

import { useState, useTransition } from "react";
import { Building2, Plus, ArrowDownLeft, ArrowUpRight, ShieldCheck, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCurrency } from "@/lib/money";

import { saveBankAccountAction } from "../actions";

interface BankAcc {
  id: string;
  accountName: string;
  bankName: string;
  accountNumberMasked: string;
  accountNumber: string;
  ifscCode: string | null;
  openingBalance: number;
  currentBalance: number;
  status: string;
}

interface Props {
  accounts: BankAcc[];
  canManage: boolean;
}

export function BankAccountsView({ accounts, canManage }: Props) {
  const [open, setOpen] = useState(false);
  const [showFullNum, setShowFullNum] = useState<Record<string, boolean>>({});

  const [accountName, setAccountName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");

  const [pending, startTransition] = useTransition();

  const handleOpenAdd = () => {
    setAccountName("");
    setBankName("");
    setAccountNumber("");
    setIfscCode("");
    setOpeningBalance("0");
    setOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountName.trim() || !bankName.trim() || !accountNumber.trim()) {
      toast.error("Please fill in required bank account fields");
      return;
    }

    startTransition(async () => {
      const res = await saveBankAccountAction({
        accountName,
        bankName,
        accountNumber,
        ifscCode,
        openingBalance: parseFloat(openingBalance) || 0,
      });

      if (res.ok) {
        toast.success("Bank account created");
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  };

  const totalBankBalance = accounts.reduce((sum, a) => sum + a.currentBalance, 0);

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <Card className="flex-1 border-info/30 bg-info/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <span className="text-xs uppercase font-semibold text-info">Total Liquid Bank Balance</span>
              <p className="text-3xl font-extrabold font-mono text-info mt-1">
                {formatCurrency(totalBankBalance)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{accounts.length} active business accounts connected</p>
            </div>
            <div className="flex size-12 items-center justify-center rounded-2xl bg-info/10 text-info">
              <Building2 className="size-6" />
            </div>
          </CardContent>
        </Card>

        {canManage && (
          <Button onClick={handleOpenAdd} size="lg" className="gap-2 bg-info text-info-foreground hover:bg-info/90 font-semibold shrink-0">
            <Plus className="size-4" /> Add Bank Account
          </Button>
        )}
      </div>

      {/* Bank Accounts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {accounts.map((acc) => (
          <Card key={acc.id} className="border-border/60 hover:border-info/40 transition">
            <CardHeader className="flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-base font-bold">{acc.bankName}</CardTitle>
                <p className="text-xs text-muted-foreground">{acc.accountName}</p>
              </div>
              <Badge tone="success" className="text-[10px]">ACTIVE</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <span className="text-xs uppercase font-semibold text-muted-foreground">Current Available Balance</span>
                <p className="text-2xl font-bold font-mono text-info mt-0.5">
                  {formatCurrency(acc.currentBalance)}
                </p>
              </div>

              <div className="rounded-lg bg-muted/40 p-2.5 text-xs space-y-1 font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">A/C Number:</span>
                  <span className="font-semibold flex items-center gap-1.5">
                    {showFullNum[acc.id] ? acc.accountNumber : acc.accountNumberMasked}
                    <button
                      type="button"
                      onClick={() => setShowFullNum((prev) => ({ ...prev, [acc.id]: !prev[acc.id] }))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {showFullNum[acc.id] ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                    </button>
                  </span>
                </div>
                {acc.ifscCode && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">IFSC Code:</span>
                    <span>{acc.ifscCode}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Opening Bal:</span>
                  <span>{formatCurrency(acc.openingBalance)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Add Bank Account Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="size-5 text-info" /> Connect New Bank Account
            </DialogTitle>
            <DialogDescription>
              Register business bank current accounts for automatic ledger tracking.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4 my-2">
            <div className="space-y-1.5">
              <Label>Bank Name</Label>
              <Input
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="e.g. HDFC Bank / SBI / ICICI"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>Account Display Name</Label>
              <Input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="e.g. HDFC Main Current Account"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Account Number</Label>
                <Input
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="50200012345678"
                  className="font-mono"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label>IFSC Code (Optional)</Label>
                <Input
                  value={ifscCode}
                  onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
                  placeholder="HDFC0001234"
                  className="font-mono uppercase"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Opening Balance (₹)</Label>
              <Input
                type="number"
                step="0.01"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                placeholder="0.00"
                className="font-mono"
              />
            </div>

            <DialogFooter className="pt-3">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending} className="bg-info text-info-foreground hover:bg-info/90 font-semibold">
                {pending ? "Connecting..." : "Add Bank Account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
