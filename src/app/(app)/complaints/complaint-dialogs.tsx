"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, MessageSquarePlus } from "lucide-react";
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
import { formatCurrency } from "@/lib/money";
import {
  createComplaintAction,
  resolveComplaintAction,
  updateComplaintAction,
  uploadComplaintAttachmentAction,
} from "@/app/(app)/complaints/actions";
import type { FieldErrors } from "@/lib/action-result";

const COMPLAINT_TYPES = [
  ["DAMAGED_GARMENT", "Damaged garment"],
  ["LOST_GARMENT", "Lost garment"],
  ["MISSING_GARMENT", "Missing garment"],
  ["COLOR_FADING", "Colour fading"],
  ["STAIN_NOT_REMOVED", "Stain not removed"],
  ["WRONG_GARMENT", "Wrong garment"],
  ["WRONG_QUANTITY", "Wrong quantity"],
  ["LATE_DELIVERY", "Late delivery"],
  ["OTHER", "Other"],
] as const;

export function NewComplaintDialog({
  branches,
  defaultBranchId,
  assignees,
  presetOrderId,
}: {
  branches: { value: string; label: string }[];
  defaultBranchId: string | null;
  assignees: { id: string; name: string }[];
  presetOrderId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [form, setForm] = useState({
    branchId: defaultBranchId ?? branches[0]?.value ?? "",
    type: "DAMAGED_GARMENT",
    priority: "MEDIUM",
    orderNumber: "",
    garmentCode: "",
    raisedByName: "",
    raisedByPhone: "",
    description: "",
    assignedToId: "none",
  });

  const set = (patch: Partial<typeof form>) =>
    setForm((current) => ({ ...current, ...patch }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <MessageSquarePlus /> Raise complaint
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Raise a complaint</DialogTitle>
          <DialogDescription>
            Link it to an order or a specific garment so the investigation has context.
          </DialogDescription>
        </DialogHeader>

        {error ? <FormError message={error} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Type" required>
            <Select value={form.type} onValueChange={(type) => set({ type })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {COMPLAINT_TYPES.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Priority">
            <Select value={form.priority} onValueChange={(priority) => set({ priority })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="LOW">Low</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="CRITICAL">Critical</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Order number" hint="e.g. ORD10245">
            <Input
              value={form.orderNumber}
              onChange={(event) => set({ orderNumber: event.target.value.toUpperCase() })}
              className="font-mono"
            />
          </FormField>

          <FormField label="Garment code" hint="e.g. G1001">
            <Input
              value={form.garmentCode}
              onChange={(event) => set({ garmentCode: event.target.value.toUpperCase() })}
              className="font-mono"
            />
          </FormField>

          <FormField label="Raised by" required error={fieldErrors.raisedByName}>
            <Input
              value={form.raisedByName}
              onChange={(event) => set({ raisedByName: event.target.value })}
            />
          </FormField>

          <FormField label="Phone" error={fieldErrors.raisedByPhone}>
            <Input
              value={form.raisedByPhone}
              onChange={(event) => set({ raisedByPhone: event.target.value })}
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

          {assignees.length > 0 ? (
            <FormField label="Assign to">
              <Select
                value={form.assignedToId}
                onValueChange={(assignedToId) => set({ assignedToId })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {assignees.map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}

          <FormField
            label="What happened?"
            required
            className="sm:col-span-2"
            error={fieldErrors.description}
          >
            <Textarea
              value={form.description}
              onChange={(event) => set({ description: event.target.value })}
              placeholder="Customer says the blue shirt came back with a tear on the right sleeve…"
              className="min-h-24"
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

                // Resolve the human-facing codes into ids before submitting.
                const lookup = await fetch(
                  `/api/lookup?order=${encodeURIComponent(form.orderNumber)}&garment=${encodeURIComponent(form.garmentCode)}`,
                ).then((response) => response.json() as Promise<{
                  orderId: string | null;
                  garmentId: string | null;
                }>);

                const result = await createComplaintAction({
                  branchId: form.branchId,
                  type: form.type,
                  priority: form.priority,
                  orderId: presetOrderId ?? lookup.orderId ?? null,
                  garmentId: lookup.garmentId ?? null,
                  raisedByName: form.raisedByName,
                  raisedByPhone: form.raisedByPhone,
                  description: form.description,
                  assignedToId: form.assignedToId === "none" ? null : form.assignedToId,
                });

                if (result.ok) {
                  toast.success(`${result.data.complaintNumber} logged`);
                  setOpen(false);
                  router.push(`/complaints/${result.data.id}`);
                  router.refresh();
                } else {
                  setError(result.error);
                  setFieldErrors(result.fieldErrors ?? {});
                }
              })
            }
          >
            Log complaint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ComplaintWorkflow({
  complaintId,
  status,
  priority,
  assignedToId,
  investigationNotes,
  assignees,
  maxRefund,
  canManage,
  canResolve,
}: {
  complaintId: string;
  status: string;
  priority: string;
  assignedToId: string | null;
  investigationNotes: string | null;
  assignees: { id: string; name: string }[];
  maxRefund: number;
  canManage: boolean;
  canResolve: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notes, setNotes] = useState(investigationNotes ?? "");
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolution, setResolution] = useState("REWASH");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [amount, setAmount] = useState(0);

  const closed = ["RESOLVED", "CLOSED"].includes(status);

  const save = (patch: Record<string, unknown>) =>
    startTransition(async () => {
      const result = await updateComplaintAction({ complaintId, ...patch });
      if (result.ok) {
        toast.success("Complaint updated");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <div className="space-y-4">
      {canManage && !closed ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Status">
            <Select value={status} onValueChange={(value) => save({ status: value })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="UNDER_INVESTIGATION">Under investigation</SelectItem>
                <SelectItem value="AWAITING_CUSTOMER">Awaiting customer</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
                <SelectItem value="CLOSED">Closed</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Priority">
            <Select value={priority} onValueChange={(value) => save({ priority: value })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="LOW">Low</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="CRITICAL">Critical</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Assigned to">
            <Select
              value={assignedToId ?? "none"}
              onValueChange={(value) =>
                save({ assignedToId: value === "none" ? null : value })
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {assignees.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
      ) : null}

      {canManage ? (
        <FormField label="Investigation notes">
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={closed}
            className="min-h-24"
            placeholder="Checked CCTV at the QC station, garment arrived already torn…"
          />
        </FormField>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canManage && !closed ? (
          <Button
            variant="outline"
            loading={isPending}
            onClick={() => save({ investigationNotes: notes })}
          >
            Save notes
          </Button>
        ) : null}

        {canResolve && !closed ? (
          <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
            <DialogTrigger asChild>
              <Button>Resolve complaint</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Resolve this complaint</DialogTitle>
                <DialogDescription>
                  A rewash or rework sends the garment back through processing; a
                  refund is booked against the order.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <FormField label="Resolution" required>
                  <Select value={resolution} onValueChange={setResolution}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="REWASH">Rewash</SelectItem>
                      <SelectItem value="REWORK">Rework</SelectItem>
                      <SelectItem value="REFUND">Refund</SelectItem>
                      <SelectItem value="COMPENSATION">Compensation</SelectItem>
                      <SelectItem value="REPLACEMENT">Replacement</SelectItem>
                      <SelectItem value="APOLOGY">Apology</SelectItem>
                      <SelectItem value="NO_ACTION">No action</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>

                {["REFUND", "COMPENSATION"].includes(resolution) ? (
                  <FormField
                    label="Amount ₹"
                    required
                    hint={
                      resolution === "REFUND"
                        ? `Up to ${formatCurrency(maxRefund)} can be refunded`
                        : undefined
                    }
                  >
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={amount}
                      onChange={(event) =>
                        setAmount(Math.max(0, Number(event.target.value) || 0))
                      }
                    />
                  </FormField>
                ) : null}

                <FormField label="Resolution notes" required>
                  <Textarea
                    value={resolutionNotes}
                    onChange={(event) => setResolutionNotes(event.target.value)}
                    placeholder="Garment rewashed free of charge and delivered the same evening…"
                  />
                </FormField>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setResolveOpen(false)}>
                  Cancel
                </Button>
                <Button
                  loading={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await resolveComplaintAction({
                        complaintId,
                        resolution,
                        resolutionNotes,
                        compensationAmount: amount,
                      });
                      if (result.ok) {
                        toast.success("Complaint resolved");
                        setResolveOpen(false);
                        router.refresh();
                      } else {
                        toast.error(result.error);
                      }
                    })
                  }
                >
                  Resolve
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </div>
  );
}

export function ComplaintAttachmentUpload({ complaintId }: { complaintId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const formData = new FormData();
          formData.set("complaintId", complaintId);
          formData.set("file", file);
          startTransition(async () => {
            const result = await uploadComplaintAttachmentAction(formData);
            if (result.ok) {
              toast.success("Photo added");
              router.refresh();
            } else {
              toast.error(result.error);
            }
            if (fileRef.current) fileRef.current.value = "";
          });
        }}
      />
      <Button
        variant="outline"
        size="sm"
        loading={isPending}
        onClick={() => fileRef.current?.click()}
      >
        <ImagePlus /> Add photo
      </Button>
    </>
  );
}
