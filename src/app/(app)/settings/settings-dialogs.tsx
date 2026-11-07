"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Label } from "@/components/ui/label";
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
  createExpenseAction,
  decideExpenseAction,
  resendNotificationAction,
  saveBranchAction,
  saveGarmentTypeAction,
  saveServiceAction,
  saveServiceRateAction,
  saveSettingsAction,
  saveTemplateAction,
} from "@/app/(app)/settings/actions";
import type { FieldErrors } from "@/lib/action-result";

const STAGES = [
  ["SORTING", "Sorting"],
  ["WASHING", "Washing"],
  ["DRYING", "Drying"],
  ["IRONING", "Ironing"],
  ["QUALITY_CHECK", "Quality control"],
  ["PACKING", "Packing"],
] as const;

export function BranchDialog({
  branches,
  branch,
}: {
  branches: { id: string; name: string }[];
  branch?: {
    id: string;
    code: string;
    name: string;
    type: string;
    parentId: string | null;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    phone: string | null;
    email: string | null;
    gstNumber: string | null;
    isActive: boolean;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [form, setForm] = useState({
    code: branch?.code ?? "",
    name: branch?.name ?? "",
    type: branch?.type ?? "BRANCH",
    parentId: branch?.parentId ?? "none",
    addressLine: branch?.addressLine ?? "",
    city: branch?.city ?? "",
    state: branch?.state ?? "",
    pincode: branch?.pincode ?? "",
    phone: branch?.phone ?? "",
    email: branch?.email ?? "",
    gstNumber: branch?.gstNumber ?? "",
    isActive: branch?.isActive ?? true,
  });

  const set = (patch: Partial<typeof form>) =>
    setForm((current) => ({ ...current, ...patch }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {branch ? (
          <Button variant="outline" size="sm">
            Edit
          </Button>
        ) : (
          <Button>
            <Plus /> New branch
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{branch ? `Edit ${branch.name}` : "Add a branch"}</DialogTitle>
          <DialogDescription>
            Branches, the head office and the central processing unit all live in
            one hierarchy.
          </DialogDescription>
        </DialogHeader>

        {error ? <FormError message={error} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Code" required error={fieldErrors.code}>
            <Input
              value={form.code}
              onChange={(event) => set({ code: event.target.value.toUpperCase() })}
              placeholder="BR1"
              className="font-mono"
            />
          </FormField>
          <FormField label="Name" required error={fieldErrors.name}>
            <Input value={form.name} onChange={(event) => set({ name: event.target.value })} />
          </FormField>
          <FormField label="Type">
            <Select value={form.type} onValueChange={(type) => set({ type })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="HEAD_OFFICE">Head office</SelectItem>
                <SelectItem value="BRANCH">Branch</SelectItem>
                <SelectItem value="CENTRAL_PROCESSING_UNIT">
                  Central processing unit
                </SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Reports to">
            <Select value={form.parentId} onValueChange={(parentId) => set({ parentId })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No parent</SelectItem>
                {branches
                  .filter((candidate) => candidate.id !== branch?.id)
                  .map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
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
          <FormField label="City">
            <Input value={form.city} onChange={(event) => set({ city: event.target.value })} />
          </FormField>
          <FormField label="State">
            <Input value={form.state} onChange={(event) => set({ state: event.target.value })} />
          </FormField>
          <FormField label="Pincode">
            <Input
              value={form.pincode}
              onChange={(event) => set({ pincode: event.target.value })}
            />
          </FormField>
          <FormField label="Address" className="sm:col-span-2">
            <Textarea
              value={form.addressLine}
              onChange={(event) => set({ addressLine: event.target.value })}
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox
              checked={form.isActive}
              onCheckedChange={(checked) => set({ isActive: checked === true })}
            />
            Active
          </label>
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
                const result = await saveBranchAction({
                  ...form,
                  id: branch?.id,
                  parentId: form.parentId === "none" ? null : form.parentId,
                });
                if (result.ok) {
                  toast.success("Branch saved");
                  setOpen(false);
                  router.refresh();
                } else {
                  setError(result.error);
                  setFieldErrors(result.fieldErrors ?? {});
                }
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ServiceDialog({
  service,
}: {
  service?: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    pricingMode: string;
    basePrice: number;
    turnaroundHours: number;
    stages: string[];
    isActive: boolean;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [form, setForm] = useState({
    code: service?.code ?? "",
    name: service?.name ?? "",
    description: service?.description ?? "",
    pricingMode: service?.pricingMode ?? "PER_PIECE",
    basePrice: service?.basePrice ?? 0,
    turnaroundHours: service?.turnaroundHours ?? 48,
    stages: service?.stages ?? ["SORTING", "WASHING", "DRYING", "IRONING", "QUALITY_CHECK", "PACKING"],
    isActive: service?.isActive ?? true,
  });

  const set = (patch: Partial<typeof form>) =>
    setForm((current) => ({ ...current, ...patch }));

  const toggleStage = (stage: string, checked: boolean) =>
    set({
      stages: checked
        ? [...new Set([...form.stages, stage])]
        : form.stages.filter((entry) => entry !== stage),
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {service ? (
          <Button variant="outline" size="sm">
            Edit
          </Button>
        ) : (
          <Button>
            <Plus /> New service
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{service ? `Edit ${service.name}` : "Add a service"}</DialogTitle>
          <DialogDescription>
            The stages you pick define the pipeline every garment on this service
            will travel.
          </DialogDescription>
        </DialogHeader>

        {error ? <FormError message={error} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Code" required error={fieldErrors.code}>
            <Input
              value={form.code}
              onChange={(event) => set({ code: event.target.value.toUpperCase() })}
              className="font-mono"
            />
          </FormField>
          <FormField label="Name" required error={fieldErrors.name}>
            <Input value={form.name} onChange={(event) => set({ name: event.target.value })} />
          </FormField>
          <FormField label="Charged by">
            <Select
              value={form.pricingMode}
              onValueChange={(pricingMode) => set({ pricingMode })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PER_PIECE">Per piece</SelectItem>
                <SelectItem value="PER_KG">Per kilogram</SelectItem>
                <SelectItem value="FLAT">Flat rate</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Base price ₹" required>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.basePrice}
              onChange={(event) => set({ basePrice: Number(event.target.value) || 0 })}
            />
          </FormField>
          <FormField label="Turnaround (hours)">
            <Input
              type="number"
              min={1}
              value={form.turnaroundHours}
              onChange={(event) =>
                set({ turnaroundHours: Number(event.target.value) || 48 })
              }
            />
          </FormField>
          <FormField label="Description" className="sm:col-span-2">
            <Textarea
              value={form.description}
              onChange={(event) => set({ description: event.target.value })}
            />
          </FormField>

          <div className="sm:col-span-2">
            <Label className="mb-2 block">Processing stages</Label>
            <div className="grid grid-cols-2 gap-2">
              {STAGES.map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.stages.includes(value)}
                    onCheckedChange={(checked) => toggleStage(value, checked === true)}
                  />
                  {label}
                </label>
              ))}
            </div>
            {fieldErrors.stages ? (
              <p className="mt-1 text-xs text-destructive">{fieldErrors.stages[0]}</p>
            ) : null}
          </div>

          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox
              checked={form.isActive}
              onCheckedChange={(checked) => set({ isActive: checked === true })}
            />
            Offered to customers
          </label>
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
                const result = await saveServiceAction({ ...form, id: service?.id });
                if (result.ok) {
                  toast.success("Service saved");
                  setOpen(false);
                  router.refresh();
                } else {
                  setError(result.error);
                  setFieldErrors(result.fieldErrors ?? {});
                }
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GarmentTypeDialog({
  garmentType,
}: {
  garmentType?: {
    id: string;
    code: string;
    name: string;
    category: string;
    isActive: boolean;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: garmentType?.code ?? "",
    name: garmentType?.name ?? "",
    category: garmentType?.category ?? "GENERAL",
    isActive: garmentType?.isActive ?? true,
  });

  const set = (patch: Partial<typeof form>) =>
    setForm((current) => ({ ...current, ...patch }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {garmentType ? (
          <Button variant="outline" size="sm">
            Edit
          </Button>
        ) : (
          <Button variant="outline">
            <Plus /> New garment type
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {garmentType ? `Edit ${garmentType.name}` : "Add a garment type"}
          </DialogTitle>
          <DialogDescription>
            Garment types are what the counter picks from when booking an order.
          </DialogDescription>
        </DialogHeader>

        {error ? <FormError message={error} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Code" required>
            <Input
              value={form.code}
              onChange={(event) => set({ code: event.target.value.toUpperCase() })}
              className="font-mono"
            />
          </FormField>
          <FormField label="Name" required>
            <Input value={form.name} onChange={(event) => set({ name: event.target.value })} />
          </FormField>
          <FormField label="Category" hint="Upper wear, lower wear, linen…">
            <Input
              value={form.category}
              onChange={(event) => set({ category: event.target.value.toUpperCase() })}
            />
          </FormField>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <Checkbox
              checked={form.isActive}
              onCheckedChange={(checked) => set({ isActive: checked === true })}
            />
            Accepted
          </label>
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
                const result = await saveGarmentTypeAction({
                  ...form,
                  id: garmentType?.id,
                });
                if (result.ok) {
                  toast.success("Garment type saved");
                  setOpen(false);
                  router.refresh();
                } else {
                  setError(result.error);
                }
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RateInput({
  serviceId,
  garmentTypeId,
  price,
}: {
  serviceId: string;
  garmentTypeId: string;
  price: number | null;
}) {
  const [value, setValue] = useState(price ?? 0);
  const [isPending, startTransition] = useTransition();

  return (
    <Input
      type="number"
      min={0}
      step="0.01"
      value={value}
      disabled={isPending}
      className="h-8 w-24 text-right text-xs"
      aria-label="Rate"
      onChange={(event) => setValue(Number(event.target.value) || 0)}
      onBlur={() => {
        if (value === (price ?? 0)) return;
        startTransition(async () => {
          const result = await saveServiceRateAction({
            serviceId,
            garmentTypeId,
            price: value,
          });
          if (result.ok) toast.success("Rate saved");
          else toast.error(result.error);
        });
      }}
    />
  );
}

export function TemplateDialog({
  template,
}: {
  template?: {
    id: string;
    code: string;
    name: string;
    channel: string;
    event: string;
    subject: string | null;
    body: string;
    isActive: boolean;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: template?.code ?? "",
    name: template?.name ?? "",
    channel: template?.channel ?? "IN_APP",
    event: template?.event ?? "ORDER_RECEIVED",
    subject: template?.subject ?? "",
    body: template?.body ?? "",
    isActive: template?.isActive ?? true,
  });

  const set = (patch: Partial<typeof form>) =>
    setForm((current) => ({ ...current, ...patch }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {template ? (
          <Button variant="outline" size="sm">
            Edit
          </Button>
        ) : (
          <Button>
            <Plus /> New template
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{template ? `Edit ${template.name}` : "Add a template"}</DialogTitle>
          <DialogDescription>
            Use {"{{customerName}}"}, {"{{orderNumber}}"}, {"{{outstanding}}"} and{" "}
            {"{{expectedDelivery}}"} as placeholders.
          </DialogDescription>
        </DialogHeader>

        {error ? <FormError message={error} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Code" required hint="Lowercase, underscores only">
            <Input
              value={form.code}
              onChange={(event) =>
                set({ code: event.target.value.toLowerCase().replace(/\s+/g, "_") })
              }
              className="font-mono"
            />
          </FormField>
          <FormField label="Name" required>
            <Input value={form.name} onChange={(event) => set({ name: event.target.value })} />
          </FormField>
          <FormField label="Channel">
            <Select value={form.channel} onValueChange={(channel) => set({ channel })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="IN_APP">In-app notice</SelectItem>
                <SelectItem value="EMAIL">Email</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Trigger">
            <Select value={form.event} onValueChange={(event) => set({ event })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ORDER_RECEIVED">Order received</SelectItem>
                <SelectItem value="PROCESSING_STARTED">Processing started</SelectItem>
                <SelectItem value="ORDER_READY">Order ready</SelectItem>
                <SelectItem value="OUT_FOR_DELIVERY">Out for delivery</SelectItem>
                <SelectItem value="DELIVERED">Delivered</SelectItem>
                <SelectItem value="PAYMENT_RECEIVED">Payment received</SelectItem>
                <SelectItem value="PAYMENT_REMINDER">Payment reminder</SelectItem>
                <SelectItem value="ORDER_DELAYED">Order delayed</SelectItem>
                <SelectItem value="PICKUP_SCHEDULED">Pickup scheduled</SelectItem>
                <SelectItem value="COMPLAINT_REGISTERED">Complaint registered</SelectItem>
                <SelectItem value="COMPLAINT_RESOLVED">Complaint resolved</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          {form.channel === "EMAIL" ? (
            <FormField label="Subject" className="sm:col-span-2">
              <Input
                value={form.subject}
                onChange={(event) => set({ subject: event.target.value })}
              />
            </FormField>
          ) : null}
          <FormField label="Message" required className="sm:col-span-2">
            <Textarea
              value={form.body}
              onChange={(event) => set({ body: event.target.value })}
              className="min-h-28 font-mono text-xs"
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox
              checked={form.isActive}
              onCheckedChange={(checked) => set({ isActive: checked === true })}
            />
            Active — messages are sent using this template
          </label>
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
                const result = await saveTemplateAction({ ...form, id: template?.id });
                if (result.ok) {
                  toast.success("Template saved");
                  setOpen(false);
                  router.refresh();
                } else {
                  setError(result.error);
                }
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ResendButton({ notificationId }: { notificationId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Resend"
      loading={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await resendNotificationAction(notificationId);
          if (result.ok) {
            toast.success("Message resent");
            router.refresh();
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      <Send />
    </Button>
  );
}

export function GeneralSettingsForm({
  initial,
}: {
  initial: {
    gstRate: number;
    appName: string;
    defaultTurnaroundHours: number;
    lowStockAlerts: boolean;
    requireFullPaymentBeforeDelivery: boolean;
  };
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(initial);

  const set = (patch: Partial<typeof form>) =>
    setForm((current) => ({ ...current, ...patch }));

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await saveSettingsAction(form);
          if (result.ok) toast.success("Settings saved");
          else setError(result.error);
        });
      }}
    >
      {error ? <FormError message={error} /> : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Business name">
          <Input
            value={form.appName}
            onChange={(event) => set({ appName: event.target.value })}
          />
        </FormField>
        <FormField label="Default GST rate %">
          <Input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={form.gstRate}
            onChange={(event) => set({ gstRate: Number(event.target.value) || 0 })}
          />
        </FormField>
        <FormField label="Default turnaround (hours)">
          <Input
            type="number"
            min={1}
            value={form.defaultTurnaroundHours}
            onChange={(event) =>
              set({ defaultTurnaroundHours: Number(event.target.value) || 48 })
            }
          />
        </FormField>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <Checkbox
            checked={form.lowStockAlerts}
            onCheckedChange={(checked) => set({ lowStockAlerts: checked === true })}
          />
          Show low-stock alerts on the dashboard
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <Checkbox
            checked={form.requireFullPaymentBeforeDelivery}
            onCheckedChange={(checked) =>
              set({ requireFullPaymentBeforeDelivery: checked === true })
            }
          />
          Block delivery until the balance is fully paid
        </label>
      </div>

      <Button type="submit" loading={isPending}>
        <RefreshCw /> Save settings
      </Button>
    </form>
  );
}

export function ExpenseDialog({
  branches,
  defaultBranchId,
}: {
  branches: { value: string; label: string }[];
  defaultBranchId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    branchId: defaultBranchId ?? branches[0]?.value ?? "",
    category: "CONSUMABLES",
    amount: 0,
    description: "",
    paidTo: "",
    paymentMethod: "CASH",
    reference: "",
    expenseDate: new Date().toISOString().slice(0, 10),
  });

  const set = (patch: Partial<typeof form>) =>
    setForm((current) => ({ ...current, ...patch }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Record expense
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record an expense</DialogTitle>
          <DialogDescription>
            Approved expenses feed the profit figure in finance reports.
          </DialogDescription>
        </DialogHeader>

        {error ? <FormError message={error} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Category">
            <Select value={form.category} onValueChange={(category) => set({ category })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {[
                  "RENT",
                  "SALARY",
                  "UTILITIES",
                  "MAINTENANCE",
                  "TRANSPORT",
                  "CONSUMABLES",
                  "MARKETING",
                  "MISCELLANEOUS",
                ].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value.charAt(0) + value.slice(1).toLowerCase()}
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
              value={form.amount}
              onChange={(event) => set({ amount: Number(event.target.value) || 0 })}
            />
          </FormField>
          <FormField label="Date">
            <Input
              type="date"
              value={form.expenseDate}
              onChange={(event) => set({ expenseDate: event.target.value })}
            />
          </FormField>
          <FormField label="Method">
            <Select
              value={form.paymentMethod}
              onValueChange={(paymentMethod) => set({ paymentMethod })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CASH">Cash</SelectItem>
                <SelectItem value="UPI">UPI</SelectItem>
                <SelectItem value="CARD">Card</SelectItem>
                <SelectItem value="ONLINE">Online</SelectItem>
                <SelectItem value="BANK_TRANSFER">Bank transfer</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          {branches.length > 1 ? (
            <FormField label="Branch">
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
          <FormField label="Paid to">
            <Input
              value={form.paidTo}
              onChange={(event) => set({ paidTo: event.target.value })}
            />
          </FormField>
          <FormField label="Description" required className="sm:col-span-2">
            <Textarea
              value={form.description}
              onChange={(event) => set({ description: event.target.value })}
            />
          </FormField>
          <FormField label="Reference" className="sm:col-span-2">
            <Input
              value={form.reference}
              onChange={(event) => set({ reference: event.target.value })}
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
                const result = await createExpenseAction(form);
                if (result.ok) {
                  toast.success(`${result.data.expenseNumber} recorded`);
                  setOpen(false);
                  set({ amount: 0, description: "", reference: "" });
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

export function ExpenseDecisionControls({ expenseId }: { expenseId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const decide = (status: "APPROVED" | "REJECTED" | "PAID") =>
    startTransition(async () => {
      const result = await decideExpenseAction({ expenseId, status });
      if (result.ok) {
        toast.success(`Expense ${status.toLowerCase()}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <div className="flex gap-1.5">
      <Button size="sm" variant="outline" loading={isPending} onClick={() => decide("APPROVED")}>
        Approve
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive"
        loading={isPending}
        onClick={() => decide("REJECTED")}
      >
        Reject
      </Button>
    </div>
  );
}
