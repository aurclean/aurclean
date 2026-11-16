"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { addFirmManagerAction, setFirmManagerStatusAction } from "@/app/(app)/firms/actions";

export function ManagerStatusButton({ userId, status }: { userId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next = status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
  return (
    <Button
      size="sm"
      variant="outline"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setFirmManagerStatusAction(userId, next);
          if (result.ok) {
            toast.success(next === "ACTIVE" ? "Access activated" : "Access deactivated");
            router.refresh();
          } else toast.error(result.error);
        })
      }
    >
      {status === "ACTIVE" ? "Deactivate" : "Activate"}
    </Button>
  );
}

export function AddFirmManagerDialog({ firmId }: { firmId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ name: string; code: string } | null>(null);

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setIssued(null); setError(null); } }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Add another Firm Manager</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        {issued ? (
          <>
            <DialogHeader>
              <DialogTitle>{issued.name} can now sign in</DialogTitle>
              <DialogDescription>Share this code now — it is stored only as a hash and cannot be shown again.</DialogDescription>
            </DialogHeader>
            <p className="text-center font-mono text-2xl font-bold tracking-widest">{issued.code}</p>
            <DialogFooter><Button onClick={() => setOpen(false)}>Done</Button></DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add a Firm Manager</DialogTitle>
              <DialogDescription>The account is created inside this firm only.</DialogDescription>
            </DialogHeader>
            {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button
                loading={pending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    const result = await addFirmManagerAction({ firmId, ...form });
                    if (result.ok) {
                      setIssued({ name: form.name, code: result.data.accessCode });
                      setForm({ name: "", email: "", phone: "" });
                      router.refresh();
                    } else setError(result.error);
                  })
                }
              >
                Create manager
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
