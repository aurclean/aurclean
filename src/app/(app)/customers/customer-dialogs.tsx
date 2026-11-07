"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormField } from "@/components/shared/form-field";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";

import {
  createCustomerAction,
  deleteCustomerAction,
  updateCustomerAction,
} from "./actions";

interface Fields {
  name: string;
  phone: string;
  email: string;
  addressLine: string;
  city: string;
  pincode: string;
  landmark: string;
  notes: string;
}

const EMPTY: Fields = {
  name: "",
  phone: "",
  email: "",
  addressLine: "",
  city: "",
  pincode: "",
  landmark: "",
  notes: "",
};

function FieldsForm({
  value,
  onChange,
}: {
  value: Fields;
  onChange: (next: Fields) => void;
}) {
  const set = (key: keyof Fields) => (event: { target: { value: string } }) =>
    onChange({ ...value, [key]: event.target.value });

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormField label="Name" required className="sm:col-span-2">
        <Input value={value.name} onChange={set("name")} autoFocus />
      </FormField>
      <FormField label="Phone" required>
        <Input value={value.phone} onChange={set("phone")} inputMode="tel" />
      </FormField>
      <FormField label="Email">
        <Input value={value.email} onChange={set("email")} type="email" />
      </FormField>
      <FormField label="Address" className="sm:col-span-2">
        <Input value={value.addressLine} onChange={set("addressLine")} />
      </FormField>
      <FormField label="City">
        <Input value={value.city} onChange={set("city")} />
      </FormField>
      <FormField label="Pincode">
        <Input value={value.pincode} onChange={set("pincode")} inputMode="numeric" />
      </FormField>
      <FormField label="Landmark" className="sm:col-span-2">
        <Input value={value.landmark} onChange={set("landmark")} />
      </FormField>
      <FormField label="Notes" className="sm:col-span-2" hint="Preferences, allergies, gate codes…">
        <Textarea value={value.notes} onChange={set("notes")} rows={3} />
      </FormField>
    </div>
  );
}

export function NewCustomerDialog({
  branches,
  defaultBranchId,
}: {
  branches: { value: string; label: string }[];
  defaultBranchId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [branchId, setBranchId] = useState(defaultBranchId ?? branches[0]?.value ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setFields(EMPTY);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> New customer
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
          <DialogDescription>
            Adds a directory entry. Booking an order for a new phone number creates one
            automatically, so this is for regulars you want on file first.
          </DialogDescription>
        </DialogHeader>

        {branches.length > 1 ? (
          <FormField label="Branch" required>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
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

        <FieldsForm value={fields} onChange={setFields} />

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || !fields.name.trim() || !fields.phone.trim() || !branchId}
            onClick={() =>
              startTransition(async () => {
                const result = await createCustomerAction({ ...fields, branchId });
                if (result.ok) {
                  toast.success(`${fields.name} added`);
                  setOpen(false);
                  router.push(`/customers/${result.data.id}`);
                } else {
                  toast.error(result.error);
                }
              })
            }
          >
            Add customer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Removing a customer. One with orders is retired rather than destroyed — the
 * orders carry the billing snapshot and deleting the row would orphan history.
 */
export function DeleteCustomerButton({
  customerId,
  name,
  orderCount,
}: {
  customerId: string;
  name: string;
  orderCount: number;
}) {
  const router = useRouter();

  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" className="text-destructive hover:bg-destructive/10">
          <Trash2 /> {orderCount > 0 ? "Retire" : "Delete"}
        </Button>
      }
      title={orderCount > 0 ? `Retire ${name}?` : `Delete ${name}?`}
      description={
        orderCount > 0
          ? `${name} has ${orderCount} order${orderCount === 1 ? "" : "s"}, so the record is kept and taken out of the pickers instead. Every order stays exactly as it is.`
          : "This customer has never placed an order, so the record is removed outright."
      }
      confirmLabel={orderCount > 0 ? "Retire customer" : "Delete customer"}
      destructive
      successMessage={orderCount > 0 ? `${name} retired` : `${name} deleted`}
      action={() => deleteCustomerAction({ customerId })}
      onDone={() => router.push("/customers")}
    />
  );
}

export function EditCustomerDialog({
  customer,
}: {
  customer: Fields & { id: string; isActive: boolean };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Fields>(customer);
  const [isActive, setIsActive] = useState(customer.isActive);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setFields(customer);
          setIsActive(customer.isActive);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Pencil /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {customer.name}</DialogTitle>
          <DialogDescription>
            Changes apply to the directory. Orders already placed keep the details they
            were booked with.
          </DialogDescription>
        </DialogHeader>

        <FieldsForm value={fields} onChange={setFields} />

        <label className="flex items-center gap-2 text-sm">
          <Switch checked={isActive} onCheckedChange={setIsActive} />
          Active customer
        </label>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || !fields.name.trim() || !fields.phone.trim()}
            onClick={() =>
              startTransition(async () => {
                const result = await updateCustomerAction({
                  ...fields,
                  customerId: customer.id,
                  isActive,
                });
                if (result.ok) {
                  toast.success("Customer updated");
                  setOpen(false);
                  router.refresh();
                } else {
                  toast.error(result.error);
                }
              })
            }
          >
            Save changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
