"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Package, Plus } from "lucide-react";
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
import { FormError, FormField } from "@/components/shared/form-field";
import {
  recordStockMovementAction,
  saveInventoryItemAction,
  transferStockAction,
} from "@/app/(app)/inventory/actions";
import type { FieldErrors } from "@/lib/action-result";

const CATEGORIES = [
  "DETERGENT",
  "BLEACH",
  "FABRIC_SOFTENER",
  "STAIN_REMOVER",
  "CHEMICAL",
  "PACKAGING",
  "HANGER",
  "COVER",
  "TAG",
  "LABEL",
  "OTHER",
] as const;

const label = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export function NewItemDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [form, setForm] = useState({
    sku: "",
    name: "",
    category: "DETERGENT",
    unit: "L",
    minStockLevel: 10,
    costPrice: 0,
    description: "",
  });

  const set = (patch: Partial<typeof form>) =>
    setForm((current) => ({ ...current, ...patch }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New item
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a consumable</DialogTitle>
          <DialogDescription>
            Track detergents, packaging, hangers, tags and anything else the floor uses.
          </DialogDescription>
        </DialogHeader>

        {error ? <FormError message={error} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="SKU" required error={fieldErrors.sku}>
            <Input
              value={form.sku}
              onChange={(event) => set({ sku: event.target.value.toUpperCase() })}
              placeholder="DET-001"
              className="font-mono"
            />
          </FormField>
          <FormField label="Name" required error={fieldErrors.name}>
            <Input value={form.name} onChange={(event) => set({ name: event.target.value })} />
          </FormField>
          <FormField label="Category">
            <Select value={form.category} onValueChange={(category) => set({ category })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {label(category)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Unit" hint="L, kg, pcs, box…">
            <Input value={form.unit} onChange={(event) => set({ unit: event.target.value })} />
          </FormField>
          <FormField label="Minimum stock" hint="Triggers the low-stock alert">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.minStockLevel}
              onChange={(event) => set({ minStockLevel: Number(event.target.value) || 0 })}
            />
          </FormField>
          <FormField label="Cost price ₹">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.costPrice}
              onChange={(event) => set({ costPrice: Number(event.target.value) || 0 })}
            />
          </FormField>
          <FormField label="Description" className="sm:col-span-2">
            <Textarea
              value={form.description}
              onChange={(event) => set({ description: event.target.value })}
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
                const result = await saveInventoryItemAction({ ...form, isActive: true });
                if (result.ok) {
                  toast.success(`${form.name} added`);
                  setOpen(false);
                  setForm({ ...form, sku: "", name: "" });
                  router.refresh();
                } else {
                  setError(result.error);
                  setFieldErrors(result.fieldErrors ?? {});
                }
              })
            }
          >
            Add item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StockMovementDialog({
  items,
  branches,
  defaultBranchId,
  canAdjust,
}: {
  items: { id: string; name: string; sku: string; unit: string }[];
  branches: { value: string; label: string }[];
  defaultBranchId: string | null;
  canAdjust: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    itemId: items[0]?.id ?? "",
    branchId: defaultBranchId ?? branches[0]?.value ?? "",
    type: "STOCK_IN",
    quantity: 0,
    unitCost: 0,
    reference: "",
    notes: "",
  });

  const set = (patch: Partial<typeof form>) =>
    setForm((current) => ({ ...current, ...patch }));
  const item = items.find((candidate) => candidate.id === form.itemId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Package /> Record movement
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a stock movement</DialogTitle>
          <DialogDescription>
            An adjustment sets the balance; everything else adds to or draws from it.
          </DialogDescription>
        </DialogHeader>

        {error ? <FormError message={error} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Item" required className="sm:col-span-2">
            <Select value={form.itemId} onValueChange={(itemId) => set({ itemId })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {items.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.sku} · {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Movement" required>
            <Select value={form.type} onValueChange={(type) => set({ type })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="STOCK_IN">Stock in</SelectItem>
                <SelectItem value="STOCK_OUT">Stock out</SelectItem>
                <SelectItem value="CONSUMPTION">Consumption</SelectItem>
                <SelectItem value="WASTAGE">Wastage</SelectItem>
                <SelectItem value="RETURN">Return</SelectItem>
                {canAdjust ? <SelectItem value="ADJUSTMENT">Adjustment</SelectItem> : null}
              </SelectContent>
            </Select>
          </FormField>

          <FormField
            label={form.type === "ADJUSTMENT" ? "New balance" : "Quantity"}
            required
            hint={item ? `in ${item.unit}` : undefined}
          >
            <Input
              type="number"
              min={0}
              step="0.001"
              value={form.quantity}
              onChange={(event) => set({ quantity: Number(event.target.value) || 0 })}
            />
          </FormField>

          {branches.length > 1 ? (
            <FormField label="Branch" required>
              <Select value={form.branchId} onValueChange={(branchId) => set({ branchId })}>
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

          {form.type === "STOCK_IN" ? (
            <FormField label="Unit cost ₹">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.unitCost}
                onChange={(event) => set({ unitCost: Number(event.target.value) || 0 })}
              />
            </FormField>
          ) : null}

          <FormField label="Reference" className="sm:col-span-2">
            <Input
              value={form.reference}
              onChange={(event) => set({ reference: event.target.value })}
              placeholder="Invoice number, requisition…"
            />
          </FormField>

          <FormField label="Notes" className="sm:col-span-2">
            <Textarea
              value={form.notes}
              onChange={(event) => set({ notes: event.target.value })}
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
                const result = await recordStockMovementAction(form);
                if (result.ok) {
                  toast.success(`Balance is now ${result.data.balance}`);
                  setOpen(false);
                  set({ quantity: 0, reference: "", notes: "" });
                  router.refresh();
                } else {
                  setError(result.error);
                }
              })
            }
          >
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TransferStockDialog({
  items,
  branches,
  defaultBranchId,
}: {
  items: { id: string; name: string; sku: string; unit: string }[];
  branches: { value: string; label: string }[];
  defaultBranchId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    itemId: items[0]?.id ?? "",
    fromBranchId: defaultBranchId ?? branches[0]?.value ?? "",
    toBranchId: branches[1]?.value ?? "",
    quantity: 0,
    notes: "",
  });

  const set = (patch: Partial<typeof form>) =>
    setForm((current) => ({ ...current, ...patch }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <ArrowLeftRight /> Transfer
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer stock between branches</DialogTitle>
          <DialogDescription>
            Recorded as a matched out and in pair so both ledgers stay balanced.
          </DialogDescription>
        </DialogHeader>

        {error ? <FormError message={error} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Item" required className="sm:col-span-2">
            <Select value={form.itemId} onValueChange={(itemId) => set({ itemId })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {items.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.sku} · {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="From" required>
            <Select
              value={form.fromBranchId}
              onValueChange={(fromBranchId) => set({ fromBranchId })}
            >
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

          <FormField label="To" required>
            <Select value={form.toBranchId} onValueChange={(toBranchId) => set({ toBranchId })}>
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

          <FormField label="Quantity" required>
            <Input
              type="number"
              min={0}
              step="0.001"
              value={form.quantity}
              onChange={(event) => set({ quantity: Number(event.target.value) || 0 })}
            />
          </FormField>

          <FormField label="Notes" className="sm:col-span-2">
            <Textarea
              value={form.notes}
              onChange={(event) => set({ notes: event.target.value })}
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
                const result = await transferStockAction(form);
                if (result.ok) {
                  toast.success("Stock transferred");
                  setOpen(false);
                  set({ quantity: 0, notes: "" });
                  router.refresh();
                } else {
                  setError(result.error);
                }
              })
            }
          >
            Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
