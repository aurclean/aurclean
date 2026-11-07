"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Plus } from "lucide-react";
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
import { FormError, FormField } from "@/components/shared/form-field";
import {
  createFirmAction,
  resetFirmAdminAccessCodeAction,
  setFirmStatusAction,
  updateFirmAction,
} from "@/app/(app)/firms/actions";
import type { FieldErrors } from "@/lib/action-result";

const EMPTY_FORM = {
  code: "",
  name: "",
  legalName: "",
  addressLine: "",
  city: "",
  state: "",
  pincode: "",
  phone: "",
  email: "",
  gstin: "",
  pan: "",
  website: "",
  adminName: "",
  adminEmail: "",
  adminPhone: "",
};

/** Shown exactly once, right after a firm is created — the temporary access
 *  code is never stored in plaintext or retrievable again after this. */
function CredentialsRevealDialog({
  open,
  onOpenChange,
  employeeCode,
  accessCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeCode: string;
  accessCode: string;
}) {
  const copy = () => {
    navigator.clipboard.writeText(accessCode).then(() => toast.success("Access code copied"));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Firm created</DialogTitle>
          <DialogDescription>
            Share this access code with the firm's admin now — it will not be shown again.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
          <div>
            <p className="text-xs text-muted-foreground">Employee code</p>
            <p className="font-mono text-sm font-medium">{employeeCode}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Access code (one-time)</p>
            <div className="flex items-center gap-2">
              <p className="font-mono text-2xl font-bold tracking-widest">{accessCode}</p>
              <Button variant="outline" size="icon" onClick={copy} type="button">
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreateFirmDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [form, setForm] = useState(EMPTY_FORM);
  const [revealed, setRevealed] = useState<{ employeeCode: string; accessCode: string } | null>(null);

  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>
            <Plus /> New firm
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add a firm</DialogTitle>
            <DialogDescription>
              Creates a fully isolated tenant with its own Primary Admin — one that will
              never see or modify any other firm's data.
            </DialogDescription>
          </DialogHeader>

          {error ? <FormError message={error} /> : null}

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Firm code" required error={fieldErrors.code} hint="Short, unique — e.g. FALNIR">
                <Input
                  value={form.code}
                  onChange={(event) => set({ code: event.target.value.toUpperCase() })}
                  className="font-mono"
                  placeholder="FALNIR"
                />
              </FormField>
              <FormField label="Business name" required error={fieldErrors.name}>
                <Input value={form.name} onChange={(event) => set({ name: event.target.value })} />
              </FormField>
              <FormField label="Legal name" error={fieldErrors.legalName}>
                <Input value={form.legalName} onChange={(event) => set({ legalName: event.target.value })} />
              </FormField>
              <FormField label="GSTIN" error={fieldErrors.gstin}>
                <Input
                  value={form.gstin}
                  onChange={(event) => set({ gstin: event.target.value.toUpperCase() })}
                  className="font-mono"
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
              <FormField label="City" error={fieldErrors.city}>
                <Input value={form.city} onChange={(event) => set({ city: event.target.value })} />
              </FormField>
              <FormField label="State" error={fieldErrors.state}>
                <Input value={form.state} onChange={(event) => set({ state: event.target.value })} />
              </FormField>
              <FormField label="Address" className="sm:col-span-2" error={fieldErrors.addressLine}>
                <Input value={form.addressLine} onChange={(event) => set({ addressLine: event.target.value })} />
              </FormField>
            </div>

            <div className="border-t pt-4">
              <p className="mb-3 text-sm font-medium">Primary Admin</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label="Name" required error={fieldErrors.adminName}>
                  <Input value={form.adminName} onChange={(event) => set({ adminName: event.target.value })} />
                </FormField>
                <FormField label="Email" required error={fieldErrors.adminEmail}>
                  <Input
                    type="email"
                    value={form.adminEmail}
                    onChange={(event) => set({ adminEmail: event.target.value })}
                  />
                </FormField>
                <FormField label="Phone" error={fieldErrors.adminPhone}>
                  <Input value={form.adminPhone} onChange={(event) => set({ adminPhone: event.target.value })} />
                </FormField>
              </div>
            </div>
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
                  const result = await createFirmAction(form);
                  if (result.ok) {
                    setOpen(false);
                    setForm(EMPTY_FORM);
                    setRevealed({
                      employeeCode: result.data.adminEmployeeCode,
                      accessCode: result.data.adminAccessCode,
                    });
                    router.refresh();
                  } else {
                    setError(result.error);
                    setFieldErrors(result.fieldErrors ?? {});
                  }
                })
              }
            >
              Create firm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {revealed ? (
        <CredentialsRevealDialog
          open={!!revealed}
          onOpenChange={(next) => !next && setRevealed(null)}
          employeeCode={revealed.employeeCode}
          accessCode={revealed.accessCode}
        />
      ) : null}
    </>
  );
}

export function ToggleFirmStatusButton({
  firmId,
  status,
}: {
  firmId: string;
  status: "ACTIVE" | "INACTIVE";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const nextStatus = status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

  return (
    <Button
      variant={status === "ACTIVE" ? "destructive" : "default"}
      loading={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await setFirmStatusAction(firmId, nextStatus);
          if (result.ok) {
            toast.success(nextStatus === "ACTIVE" ? "Firm activated" : "Firm deactivated");
            router.refresh();
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      {status === "ACTIVE" ? "Deactivate firm" : "Activate firm"}
    </Button>
  );
}

export function ResetAdminAccessCodeButton({ userId }: { userId: string }) {
  const [isPending, startTransition] = useTransition();
  const [revealed, setRevealed] = useState<string | null>(null);

  return (
    <>
      <Button
        variant="outline"
        loading={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await resetFirmAdminAccessCodeAction(userId);
            if (result.ok) {
              setRevealed(result.data.accessCode);
            } else {
              toast.error(result.error);
            }
          })
        }
      >
        Reset admin access code
      </Button>

      <Dialog open={!!revealed} onOpenChange={(next) => !next && setRevealed(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New access code</DialogTitle>
            <DialogDescription>Share this with the admin now — it will not be shown again.</DialogDescription>
          </DialogHeader>
          <p className="text-center font-mono text-3xl font-bold tracking-widest">{revealed}</p>
          <DialogFooter>
            <Button onClick={() => setRevealed(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function EditFirmDialog({
  firm,
}: {
  firm: {
    id: string;
    name: string;
    legalName: string | null;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    phone: string | null;
    email: string | null;
    gstin: string | null;
    pan: string | null;
    website: string | null;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [form, setForm] = useState({
    name: firm.name,
    legalName: firm.legalName ?? "",
    addressLine: firm.addressLine ?? "",
    city: firm.city ?? "",
    state: firm.state ?? "",
    pincode: firm.pincode ?? "",
    phone: firm.phone ?? "",
    email: firm.email ?? "",
    gstin: firm.gstin ?? "",
    pan: firm.pan ?? "",
    website: firm.website ?? "",
  });

  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Edit details</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit {firm.name}</DialogTitle>
        </DialogHeader>

        {error ? <FormError message={error} /> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Business name" required error={fieldErrors.name}>
            <Input value={form.name} onChange={(event) => set({ name: event.target.value })} />
          </FormField>
          <FormField label="Legal name" error={fieldErrors.legalName}>
            <Input value={form.legalName} onChange={(event) => set({ legalName: event.target.value })} />
          </FormField>
          <FormField label="GSTIN" error={fieldErrors.gstin}>
            <Input
              value={form.gstin}
              onChange={(event) => set({ gstin: event.target.value.toUpperCase() })}
              className="font-mono"
            />
          </FormField>
          <FormField label="Phone" error={fieldErrors.phone}>
            <Input value={form.phone} onChange={(event) => set({ phone: event.target.value })} />
          </FormField>
          <FormField label="Email" error={fieldErrors.email}>
            <Input type="email" value={form.email} onChange={(event) => set({ email: event.target.value })} />
          </FormField>
          <FormField label="City" error={fieldErrors.city}>
            <Input value={form.city} onChange={(event) => set({ city: event.target.value })} />
          </FormField>
          <FormField label="Address" className="sm:col-span-2" error={fieldErrors.addressLine}>
            <Input value={form.addressLine} onChange={(event) => set({ addressLine: event.target.value })} />
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
                const result = await updateFirmAction({ ...form, id: firm.id });
                if (result.ok) {
                  toast.success("Firm updated");
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
