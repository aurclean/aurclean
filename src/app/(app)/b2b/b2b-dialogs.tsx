"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, CalendarClock, FileSpreadsheet, Plus, Trash2 } from "lucide-react";
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
  deleteRateCardAction,
  deleteScheduleAction,
  generateStatementAction,
  saveB2BAccountAction,
  saveContractAction,
  saveRateCardAction,
  saveScheduleAction,
} from "@/app/(app)/b2b/actions";
import type { FieldErrors } from "@/lib/action-result";

const ACCOUNT_TYPES = [
  ["HOTEL", "Hotel"],
  ["HOSPITAL", "Hospital"],
  ["HOSTEL", "Hostel"],
  ["RESTAURANT", "Restaurant"],
  ["SALON", "Salon"],
  ["GYM", "Gym"],
  ["CORPORATE", "Corporate"],
  ["OTHER", "Other"],
] as const;

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function NewAccountDialog({
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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [form, setForm] = useState({
    code: "",
    businessName: "",
    type: "HOTEL",
    contactPerson: "",
    phone: "",
    email: "",
    billingAddress: "",
    gstNumber: "",
    creditLimit: 0,
    creditDays: 30,
    paymentTerms: "",
    branchId: defaultBranchId ?? "none",
  });

  const set = (patch: Partial<typeof form>) =>
    setForm((current) => ({ ...current, ...patch }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Building2 /> New account
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a corporate account</DialogTitle>
          <DialogDescription>
            Hotels, hospitals, hostels and other bulk customers billed on credit.
          </DialogDescription>
        </DialogHeader>

        {error ? <FormError message={error} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Account code" required error={fieldErrors.code}>
            <Input
              value={form.code}
              onChange={(event) => set({ code: event.target.value.toUpperCase() })}
              placeholder="HTL-001"
              className="font-mono"
            />
          </FormField>
          <FormField label="Business name" required error={fieldErrors.businessName}>
            <Input
              value={form.businessName}
              onChange={(event) => set({ businessName: event.target.value })}
            />
          </FormField>
          <FormField label="Type" required>
            <Select value={form.type} onValueChange={(type) => set({ type })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Contact person">
            <Input
              value={form.contactPerson}
              onChange={(event) => set({ contactPerson: event.target.value })}
            />
          </FormField>
          <FormField label="Phone" required error={fieldErrors.phone}>
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
          <FormField label="Credit limit ₹" hint="0 means no limit enforced">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.creditLimit}
              onChange={(event) => set({ creditLimit: Number(event.target.value) || 0 })}
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
          <FormField label="Payment terms">
            <Input
              value={form.paymentTerms}
              onChange={(event) => set({ paymentTerms: event.target.value })}
              placeholder="Monthly billing, net 30"
            />
          </FormField>
          {branches.length > 0 ? (
            <FormField label="Home branch">
              <Select value={form.branchId} onValueChange={(branchId) => set({ branchId })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No fixed branch</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.value} value={branch.value}>
                      {branch.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}
          <FormField label="Billing address" className="sm:col-span-2">
            <Textarea
              value={form.billingAddress}
              onChange={(event) => set({ billingAddress: event.target.value })}
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
                const result = await saveB2BAccountAction({
                  ...form,
                  branchId: form.branchId === "none" ? null : form.branchId,
                  isActive: true,
                });
                if (result.ok) {
                  toast.success(`${form.businessName} added`);
                  setOpen(false);
                  router.push(`/b2b/${result.data.id}`);
                  router.refresh();
                } else {
                  setError(result.error);
                  setFieldErrors(result.fieldErrors ?? {});
                }
              })
            }
          >
            Create account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NewContractDialog({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    startDate: new Date().toISOString().slice(0, 10),
    endDate: "",
    billingCycle: "MONTHLY",
    minimumMonthlyValue: 0,
    terms: "",
  });

  const set = (patch: Partial<typeof form>) =>
    setForm((current) => ({ ...current, ...patch }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus /> New contract
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a contract</DialogTitle>
          <DialogDescription>
            Rate cards hang off a contract and are applied automatically at order entry.
          </DialogDescription>
        </DialogHeader>

        {error ? <FormError message={error} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Start date" required>
            <Input
              type="date"
              value={form.startDate}
              onChange={(event) => set({ startDate: event.target.value })}
            />
          </FormField>
          <FormField label="End date">
            <Input
              type="date"
              value={form.endDate}
              onChange={(event) => set({ endDate: event.target.value })}
            />
          </FormField>
          <FormField label="Billing cycle">
            <Select
              value={form.billingCycle}
              onValueChange={(billingCycle) => set({ billingCycle })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="WEEKLY">Weekly</SelectItem>
                <SelectItem value="FORTNIGHTLY">Fortnightly</SelectItem>
                <SelectItem value="MONTHLY">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Minimum monthly value ₹">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.minimumMonthlyValue}
              onChange={(event) =>
                set({ minimumMonthlyValue: Number(event.target.value) || 0 })
              }
            />
          </FormField>
          <FormField label="Terms" className="sm:col-span-2">
            <Textarea
              value={form.terms}
              onChange={(event) => set({ terms: event.target.value })}
              placeholder="Daily pickup at 8am, 24-hour turnaround on linen…"
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
                const result = await saveContractAction({
                  accountId,
                  ...form,
                  endDate: form.endDate || null,
                  status: "ACTIVE",
                });
                if (result.ok) {
                  toast.success(`${result.data.contractNumber} created`);
                  setOpen(false);
                  router.refresh();
                } else {
                  setError(result.error);
                }
              })
            }
          >
            Create contract
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RateCardDialog({
  contractId,
  services,
  garmentTypes,
}: {
  contractId: string;
  services: { id: string; name: string }[];
  garmentTypes: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    serviceId: services[0]?.id ?? "",
    garmentTypeId: "all",
    pricingMode: "PER_PIECE",
    rate: 0,
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: "",
  });

  const set = (patch: Partial<typeof form>) =>
    setForm((current) => ({ ...current, ...patch }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus /> Add rate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Contracted rate</DialogTitle>
          <DialogDescription>
            A garment-specific rate takes precedence over a service-wide one.
          </DialogDescription>
        </DialogHeader>

        {error ? <FormError message={error} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Service" required>
            <Select value={form.serviceId} onValueChange={(serviceId) => set({ serviceId })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {services.map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Garment type">
            <Select
              value={form.garmentTypeId}
              onValueChange={(garmentTypeId) => set({ garmentTypeId })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All garments</SelectItem>
                {garmentTypes.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                <SelectItem value="FLAT">Flat</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Rate ₹" required>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.rate}
              onChange={(event) => set({ rate: Number(event.target.value) || 0 })}
            />
          </FormField>

          <FormField label="Effective from" required>
            <Input
              type="date"
              value={form.effectiveFrom}
              onChange={(event) => set({ effectiveFrom: event.target.value })}
            />
          </FormField>
          <FormField label="Effective to">
            <Input
              type="date"
              value={form.effectiveTo}
              onChange={(event) => set({ effectiveTo: event.target.value })}
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
                const result = await saveRateCardAction({
                  contractId,
                  ...form,
                  garmentTypeId: form.garmentTypeId === "all" ? null : form.garmentTypeId,
                  effectiveTo: form.effectiveTo || null,
                });
                if (result.ok) {
                  toast.success("Rate saved");
                  setOpen(false);
                  router.refresh();
                } else {
                  setError(result.error);
                }
              })
            }
          >
            Save rate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteRateButton({ rateCardId }: { rateCardId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Remove rate"
      loading={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await deleteRateCardAction(rateCardId);
          if (result.ok) {
            toast.success("Rate removed");
            router.refresh();
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      <Trash2 className="text-destructive" />
    </Button>
  );
}

export function ScheduleDialog({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({
    type: "PICKUP",
    dayOfWeek: 1,
    timeSlot: "08:00 – 10:00",
    notes: "",
  });

  const set = (patch: Partial<typeof form>) =>
    setForm((current) => ({ ...current, ...patch }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarClock /> Add schedule
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Standing pickup or delivery</DialogTitle>
          <DialogDescription>
            A recurring slot the operations team plans routes around.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Type">
            <Select value={form.type} onValueChange={(type) => set({ type })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PICKUP">Pickup</SelectItem>
                <SelectItem value="DELIVERY">Delivery</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Day">
            <Select
              value={String(form.dayOfWeek)}
              onValueChange={(value) => set({ dayOfWeek: Number(value) })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((day, index) => (
                  <SelectItem key={day} value={String(index)}>
                    {day}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Time slot" required className="sm:col-span-2">
            <Input
              value={form.timeSlot}
              onChange={(event) => set({ timeSlot: event.target.value })}
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
                const result = await saveScheduleAction({ accountId, ...form });
                if (result.ok) {
                  toast.success("Schedule added");
                  setOpen(false);
                  router.refresh();
                } else {
                  toast.error(result.error);
                }
              })
            }
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteScheduleButton({ scheduleId }: { scheduleId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Remove schedule"
      loading={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await deleteScheduleAction(scheduleId);
          if (result.ok) {
            toast.success("Schedule removed");
            router.refresh();
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      <Trash2 className="text-destructive" />
    </Button>
  );
}

export function GenerateStatementDialog({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const [periodStart, setPeriodStart] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
  );
  const [periodEnd, setPeriodEnd] = useState(
    new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <FileSpreadsheet /> Generate statement
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Consolidated statement</DialogTitle>
          <DialogDescription>
            Rolls every order in the period into one statement and one invoice.
          </DialogDescription>
        </DialogHeader>

        {error ? <FormError message={error} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Period start" required>
            <Input
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
            />
          </FormField>
          <FormField label="Period end" required>
            <Input
              type="date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
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
                const result = await generateStatementAction({
                  accountId,
                  periodStart,
                  periodEnd,
                });
                if (result.ok) {
                  toast.success(
                    `${result.data.statementNumber} — ${result.data.orderCount} orders`,
                  );
                  setOpen(false);
                  router.refresh();
                } else {
                  setError(result.error);
                }
              })
            }
          >
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
