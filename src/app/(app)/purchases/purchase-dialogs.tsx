"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building, PackageCheck, Plus, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { FormError, FormField } from "@/components/shared/form-field";
import { formatCurrency } from "@/lib/money";
import {
  createPurchaseOrderAction,
  receiveGoodsAction,
  recordSupplierPaymentAction,
  saveSupplierAction,
} from "@/app/(app)/purchases/actions";
import type { FieldErrors } from "@/lib/action-result";

export interface ItemOption {
  id: string;
  name: string;
  sku: string;
  unit: string;
  costPrice: number;
}

export function NewSupplierDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [form, setForm] = useState({
    code: "",
    name: "",
    contactPerson: "",
    phone: "",
    email: "",
    addressLine: "",
    gstNumber: "",
    paymentTerms: "",
    creditDays: 30,
  });

  const set = (patch: Partial<typeof form>) =>
    setForm((current) => ({ ...current, ...patch }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Building /> New supplier
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a supplier</DialogTitle>
          <DialogDescription>
            Suppliers you raise purchase orders against and settle invoices with.
          </DialogDescription>
        </DialogHeader>

        {error ? <FormError message={error} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Code" required error={fieldErrors.code}>
            <Input
              value={form.code}
              onChange={(event) => set({ code: event.target.value.toUpperCase() })}
              placeholder="SUP-001"
              className="font-mono"
            />
          </FormField>
          <FormField label="Name" required error={fieldErrors.name}>
            <Input value={form.name} onChange={(event) => set({ name: event.target.value })} />
          </FormField>
          <FormField label="Contact person">
            <Input
              value={form.contactPerson}
              onChange={(event) => set({ contactPerson: event.target.value })}
            />
          </FormField>
          <FormField label="Phone" error={fieldErrors.phone}>
            <Input value={form.phone} onChange={(event) => set({ phone: event.target.value })} />
          </FormField>
          <FormField label="Email" error={fieldErrors.email}>
            <Input
              type="email"
              value={form.email}
              onChange={(event) => set({ email: event.target.value })}
            />
          </FormField>
          <FormField label="GSTIN">
            <Input
              value={form.gstNumber}
              onChange={(event) => set({ gstNumber: event.target.value.toUpperCase() })}
              className="font-mono"
            />
          </FormField>
          <FormField label="Payment terms">
            <Input
              value={form.paymentTerms}
              onChange={(event) => set({ paymentTerms: event.target.value })}
              placeholder="Net 30"
            />
          </FormField>
          <FormField label="Credit days">
            <Input
              type="number"
              min={0}
              value={form.creditDays}
              onChange={(event) => set({ creditDays: Number(event.target.value) || 0 })}
            />
          </FormField>
          <FormField label="Address" className="sm:col-span-2">
            <Textarea
              value={form.addressLine}
              onChange={(event) => set({ addressLine: event.target.value })}
            />
          </FormField>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            loading={isPending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                setFieldErrors({});
                const result = await saveSupplierAction({ ...form, isActive: true });
                if (result.ok) {
                  toast.success(`${form.name} added`);
                  setOpen(false);
                  setForm({ ...form, code: "", name: "" });
                  router.refresh();
                } else {
                  setError(result.error);
                  setFieldErrors(result.fieldErrors ?? {});
                }
              })
            }
          >
            Add supplier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface POLine {
  key: string;
  itemId: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

export function NewPurchaseOrderDialog({
  suppliers,
  items,
  branches,
  defaultBranchId,
}: {
  suppliers: { id: string; name: string; code: string }[];
  items: ItemOption[];
  branches: { value: string; label: string }[];
  defaultBranchId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const newLine = (): POLine => ({
    key: crypto.randomUUID(),
    itemId: items[0]?.id ?? "",
    quantity: 1,
    unitPrice: items[0]?.costPrice ?? 0,
    taxRate: 18,
  });

  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [branchId, setBranchId] = useState(defaultBranchId ?? branches[0]?.value ?? "");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<POLine[]>([newLine()]);

  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    const tax = lines.reduce(
      (sum, line) => sum + (line.quantity * line.unitPrice * line.taxRate) / 100,
      0,
    );
    return { subtotal, tax, total: subtotal + tax };
  }, [lines]);

  const update = (key: string, patch: Partial<POLine>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New purchase order
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Raise a purchase order</DialogTitle>
          <DialogDescription>
            Stock is only added when the goods are actually received against this order.
          </DialogDescription>
        </DialogHeader>

        {error ? <FormError message={error} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Supplier" required>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {suppliers.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    {supplier.name} ({supplier.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          {branches.length > 1 ? (
            <FormField label="Deliver to branch" required>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch.value} value={branch.value}>
                      {branch.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}

          <FormField label="Order date" required>
            <Input
              type="date"
              value={orderDate}
              onChange={(event) => setOrderDate(event.target.value)}
            />
          </FormField>
          <FormField label="Expected delivery">
            <Input
              type="date"
              value={expectedDate}
              onChange={(event) => setExpectedDate(event.target.value)}
            />
          </FormField>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Items</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines((current) => [...current, newLine()])}
            >
              <Plus /> Add line
            </Button>
          </div>

          {lines.map((line) => {
            const item = items.find((candidate) => candidate.id === line.itemId);
            return (
              <div key={line.key} className="grid grid-cols-1 gap-2 rounded-lg border border-border p-2 sm:grid-cols-12">
                <div className="sm:col-span-5">
                  <Select
                    value={line.itemId}
                    onValueChange={(itemId) =>
                      update(line.key, {
                        itemId,
                        unitPrice:
                          items.find((candidate) => candidate.id === itemId)?.costPrice ??
                          line.unitPrice,
                      })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {items.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.sku} · {option.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  type="number"
                  min={0}
                  step="0.001"
                  className="h-8 text-xs sm:col-span-2"
                  value={line.quantity}
                  onChange={(event) =>
                    update(line.key, { quantity: Number(event.target.value) || 0 })
                  }
                  aria-label={`Quantity${item ? ` in ${item.unit}` : ""}`}
                />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  className="h-8 text-xs sm:col-span-2"
                  value={line.unitPrice}
                  onChange={(event) =>
                    update(line.key, { unitPrice: Number(event.target.value) || 0 })
                  }
                  aria-label="Unit price"
                />
                <Input
                  type="number"
                  min={0}
                  max={100}
                  className="h-8 text-xs sm:col-span-2"
                  value={line.taxRate}
                  onChange={(event) =>
                    update(line.key, { taxRate: Number(event.target.value) || 0 })
                  }
                  aria-label="Tax %"
                />
                <div className="flex items-center justify-end sm:col-span-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove line"
                    disabled={lines.length === 1}
                    onClick={() =>
                      setLines((current) => current.filter((entry) => entry.key !== line.key))
                    }
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end">
          <dl className="w-48 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="numeric">{formatCurrency(totals.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Tax</dt>
              <dd className="numeric">{formatCurrency(totals.tax)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>Total</dt>
              <dd className="numeric">{formatCurrency(totals.total)}</dd>
            </div>
          </dl>
        </div>

        <FormField label="Notes">
          <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </FormField>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            loading={isPending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await createPurchaseOrderAction({
                  supplierId,
                  branchId,
                  orderDate,
                  expectedDate: expectedDate || null,
                  notes,
                  items: lines.map(({ itemId, quantity, unitPrice, taxRate }) => ({
                    itemId,
                    quantity,
                    unitPrice,
                    taxRate,
                  })),
                });
                if (result.ok) {
                  toast.success(`${result.data.poNumber} raised`);
                  setOpen(false);
                  setLines([newLine()]);
                  router.push(`/purchases/${result.data.id}`);
                  router.refresh();
                } else {
                  setError(result.error);
                }
              })
            }
          >
            Raise order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReceiveGoodsDialog({
  poId,
  poNumber,
  lines,
}: {
  poId: string;
  poNumber: string;
  lines: {
    poItemId: string;
    itemName: string;
    unit: string;
    ordered: number;
    received: number;
  }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      lines.map((line) => [line.poItemId, Math.max(0, line.ordered - line.received)]),
    ),
  );
  const [notes, setNotes] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PackageCheck /> Receive goods
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Receive against {poNumber}</DialogTitle>
          <DialogDescription>
            Received quantities are added to this branch&apos;s stock immediately.
          </DialogDescription>
        </DialogHeader>

        {error ? <FormError message={error} /> : null}

        <div className="space-y-2">
          {lines.map((line) => {
            const outstanding = Math.max(0, line.ordered - line.received);
            return (
              <div
                key={line.poItemId}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{line.itemName}</p>
                  <p className="text-xs text-muted-foreground numeric">
                    {line.received} / {line.ordered} {line.unit} received
                  </p>
                </div>
                <Input
                  type="number"
                  min={0}
                  max={outstanding}
                  step="0.001"
                  className="h-8 w-28"
                  value={quantities[line.poItemId] ?? 0}
                  disabled={outstanding <= 0}
                  onChange={(event) =>
                    setQuantities((current) => ({
                      ...current,
                      [line.poItemId]: Math.max(0, Number(event.target.value) || 0),
                    }))
                  }
                  aria-label={`Receive ${line.itemName}`}
                />
              </div>
            );
          })}
        </div>

        <FormField label="Notes">
          <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </FormField>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            loading={isPending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await receiveGoodsAction({
                  poId,
                  notes,
                  lines: Object.entries(quantities)
                    .filter(([, quantity]) => quantity > 0)
                    .map(([poItemId, quantity]) => ({ poItemId, quantity })),
                });
                if (result.ok) {
                  toast.success(`${result.data.grnNumber} recorded`);
                  setOpen(false);
                  router.refresh();
                } else {
                  setError(result.error);
                }
              })
            }
          >
            Receive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SupplierPaymentDialog({
  suppliers,
  invoices,
}: {
  suppliers: { id: string; name: string }[];
  invoices: { id: string; label: string; supplierId: string; due: number }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [invoiceId, setInvoiceId] = useState("none");
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [reference, setReference] = useState("");

  const supplierInvoices = invoices.filter(
    (invoice) => invoice.supplierId === supplierId,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Wallet /> Pay supplier
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a supplier payment</DialogTitle>
          <DialogDescription>
            Link it to an invoice to reduce that invoice&apos;s balance.
          </DialogDescription>
        </DialogHeader>

        {error ? <FormError message={error} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Supplier" required className="sm:col-span-2">
            <Select
              value={supplierId}
              onValueChange={(value) => {
                setSupplierId(value);
                setInvoiceId("none");
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {suppliers.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Against invoice" className="sm:col-span-2">
            <Select
              value={invoiceId}
              onValueChange={(value) => {
                setInvoiceId(value);
                const invoice = invoices.find((candidate) => candidate.id === value);
                if (invoice) setAmount(invoice.due);
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">On account</SelectItem>
                {supplierInvoices.map((invoice) => (
                  <SelectItem key={invoice.id} value={invoice.id}>
                    {invoice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Amount ₹" required>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(Math.max(0, Number(event.target.value) || 0))}
            />
          </FormField>

          <FormField label="Method">
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="BANK_TRANSFER">Bank transfer</SelectItem>
                <SelectItem value="CASH">Cash</SelectItem>
                <SelectItem value="UPI">UPI</SelectItem>
                <SelectItem value="CARD">Card</SelectItem>
                <SelectItem value="ONLINE">Online</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Reference" className="sm:col-span-2">
            <Input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="UTR / cheque number"
            />
          </FormField>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            loading={isPending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await recordSupplierPaymentAction({
                  supplierId,
                  invoiceId: invoiceId === "none" ? null : invoiceId,
                  amount,
                  method,
                  reference,
                });
                if (result.ok) {
                  toast.success(`${result.data.paymentNumber} recorded`);
                  setOpen(false);
                  setAmount(0);
                  router.refresh();
                } else {
                  setError(result.error);
                }
              })
            }
          >
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
