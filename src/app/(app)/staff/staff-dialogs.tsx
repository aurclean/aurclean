"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, UserPlus } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormField, FormError } from "@/components/shared/form-field";
import { ROLE_LABELS } from "@/lib/rbac";
import {
  createStaffAction,
  decideLeaveAction,
  markAttendanceAction,
  regenerateAccessCodeAction,
} from "@/app/(app)/staff/actions";
import type { FieldErrors } from "@/lib/action-result";

const ROLES = Object.keys(ROLE_LABELS) as (keyof typeof ROLE_LABELS)[];

function copyCode(code: string) {
  navigator.clipboard
    .writeText(code)
    .then(() => toast.success("Access code copied"))
    .catch(() => toast.error("Could not copy — copy it manually"));
}

/** A copyable access-code readout shown right after it is issued. */
function AccessCodeReveal({ code }: { code: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2.5">
      <span className="flex-1 font-mono text-lg font-semibold tracking-[0.3em]">{code}</span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Copy access code"
        onClick={() => copyCode(code)}
      >
        <Copy />
      </Button>
    </div>
  );
}

export function NewStaffDialog({
  branches,
  shifts,
  assignableRoles,
  defaultBranchId,
}: {
  branches: { value: string; label: string }[];
  shifts: { id: string; name: string }[];
  assignableRoles: string[];
  defaultBranchId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [issuedCode, setIssuedCode] = useState<{ name: string; code: string } | null>(null);

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "SCANNER",
    branchId: defaultBranchId ?? branches[0]?.value ?? "",
    department: "",
    designation: "",
    monthlySalary: 0,
    shiftId: "none",
  });

  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setIssuedCode(null);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> Add staff
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        {issuedCode ? (
          <>
            <DialogHeader>
              <DialogTitle>{issuedCode.name} is ready to sign in</DialogTitle>
              <DialogDescription>
                Share this access code with them securely — it is their only credential.
              </DialogDescription>
            </DialogHeader>
            <AccessCodeReveal code={issuedCode.code} />
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
        <DialogHeader>
          <DialogTitle>Add a staff member</DialogTitle>
          <DialogDescription>
            A unique access code is generated automatically once you create the account.
          </DialogDescription>
        </DialogHeader>

        {error ? <FormError message={error} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Full name" required error={fieldErrors.name}>
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </FormField>
          <FormField label="Email" required error={fieldErrors.email}>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => set({ email: e.target.value })}
            />
          </FormField>
          <FormField label="Phone" error={fieldErrors.phone}>
            <Input value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
          </FormField>

          <FormField label="Role" required>
            <Select value={form.role} onValueChange={(role) => set({ role })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.filter((role) => assignableRoles.includes(role)).map((role) => (
                  <SelectItem key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </SelectItem>
                ))}
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

          <FormField label="Department">
            <Input
              value={form.department}
              onChange={(e) => set({ department: e.target.value })}
              placeholder="Operations"
            />
          </FormField>
          <FormField label="Designation">
            <Input
              value={form.designation}
              onChange={(e) => set({ designation: e.target.value })}
              placeholder="Senior operator"
            />
          </FormField>
          <FormField label="Monthly salary ₹">
            <Input
              type="number"
              min={0}
              value={form.monthlySalary}
              onChange={(e) => set({ monthlySalary: Number(e.target.value) || 0 })}
            />
          </FormField>
          {shifts.length > 0 ? (
            <FormField label="Shift">
              <Select value={form.shiftId} onValueChange={(shiftId) => set({ shiftId })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No fixed shift</SelectItem>
                  {shifts.map((shift) => (
                    <SelectItem key={shift.id} value={shift.id}>
                      {shift.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}

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
                const result = await createStaffAction({
                  ...form,
                  shiftId: form.shiftId === "none" ? null : form.shiftId,
                });
                if (result.ok) {
                  toast.success(`${form.name} added as ${result.data.employeeCode}`);
                  setIssuedCode({ name: form.name, code: result.data.accessCode });
                  setForm({ ...form, name: "", email: "", phone: "" });
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RegenerateAccessCodeDialog({
  userId,
  name,
}: {
  userId: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [newCode, setNewCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setNewCode(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <KeyRound /> Regenerate access code
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {newCode ? `New access code for ${name}` : `Regenerate access code for ${name}`}
          </DialogTitle>
          <DialogDescription>
            {newCode
              ? "Their old code stops working immediately. Share this one securely."
              : "This immediately invalidates their current access code."}
          </DialogDescription>
        </DialogHeader>
        {error ? <FormError message={error} /> : null}
        {newCode ? (
          <AccessCodeReveal code={newCode} />
        ) : (
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={isPending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const result = await regenerateAccessCodeAction({ userId });
                  if (result.ok) {
                    toast.success("Access code regenerated");
                    setNewCode(result.data.accessCode);
                  } else {
                    setError(result.error);
                  }
                })
              }
            >
              Regenerate
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AttendanceControl({
  userId,
  date,
  current,
}: {
  userId: string;
  date: string;
  current: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Select
      value={current ?? "none"}
      disabled={isPending}
      onValueChange={(status) => {
        if (status === "none") return;
        startTransition(async () => {
          const result = await markAttendanceAction({ userId, date, status });
          if (result.ok) {
            toast.success("Attendance saved");
            router.refresh();
          } else {
            toast.error(result.error);
          }
        });
      }}
    >
      <SelectTrigger className="h-8 w-32 text-xs">
        <SelectValue placeholder="Not marked" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Not marked</SelectItem>
        <SelectItem value="PRESENT">Present</SelectItem>
        <SelectItem value="ABSENT">Absent</SelectItem>
        <SelectItem value="HALF_DAY">Half day</SelectItem>
        <SelectItem value="LEAVE">Leave</SelectItem>
        <SelectItem value="WEEKLY_OFF">Weekly off</SelectItem>
        <SelectItem value="HOLIDAY">Holiday</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function LeaveDecisionControls({ leaveId }: { leaveId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const decide = (status: "APPROVED" | "REJECTED") =>
    startTransition(async () => {
      const result = await decideLeaveAction({ leaveId, status });
      if (result.ok) {
        toast.success(`Leave ${status.toLowerCase()}`);
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
