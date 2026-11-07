"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ImagePlus,
  Pencil,
  Printer,
  ScanLine,
} from "lucide-react";
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
import { FormField } from "@/components/shared/form-field";
import { signalDataChange } from "@/components/shared/live-refresh";
import { rescanGarmentAction } from "@/app/(app)/mismatch/actions";
import {
  advanceGarmentAction,
  markGarmentAction,
  updateGarmentAction,
  uploadGarmentPhotoAction,
} from "@/app/(app)/garments/actions";

interface GarmentToolsProps {
  garmentId: string;
  garmentCode: string;
  orderId: string;
  /** The station this piece is queued at, and the one after it. */
  currentStage: string;
  nextStage: { stage: string; label: string } | null;
  canEdit: boolean;
  canUpload: boolean;
  canAdvance: boolean;
  canScan: boolean;
  details: {
    color: string | null;
    brand: string | null;
    size: string | null;
    fabric: string | null;
    stainNotes: string | null;
    damageNotes: string | null;
  };
}

export function GarmentTools({
  garmentId,
  garmentCode,
  orderId,
  currentStage,
  nextStage,
  canEdit,
  canUpload,
  canAdvance,
  canScan,
  details,
}: GarmentToolsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [markOpen, setMarkOpen] = useState(false);
  const [form, setForm] = useState(details);
  const [markStatus, setMarkStatus] = useState("DAMAGED");
  const [markNote, setMarkNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = (file: File, kind: string) => {
    const formData = new FormData();
    formData.set("garmentId", garmentId);
    formData.set("kind", kind);
    formData.set("file", file);

    startTransition(async () => {
      const result = await uploadGarmentPhotoAction(formData);
      if (result.ok) {
        toast.success("Photo uploaded");
        router.refresh();
      } else {
        toast.error(result.error);
      }
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  /** Confirms the piece is where the system says, clearing any stale finding. */
  const rescan = () =>
    startTransition(async () => {
      const result = await rescanGarmentAction({ garmentId });
      if (result.ok) {
        toast.success(`${garmentCode} confirmed by scan`);
        signalDataChange();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  /** Moves the piece on to the next station on its own route. */
  const advance = () => {
    if (!nextStage) return;
    startTransition(async () => {
      const result = await advanceGarmentAction({
        garmentId,
        stage: nextStage.stage,
        outcome: "COMPLETED",
        scannedVia: "garment page",
      });
      if (result.ok) {
        toast.success(`${garmentCode} cleared ${nextStage.stage.replace(/_/g, " ").toLowerCase()}`);
        if (result.data.mismatchAlert) toast.error(result.data.mismatchAlert);
        signalDataChange();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex flex-wrap gap-2">
      {canAdvance && nextStage ? (
        <Button loading={isPending} onClick={advance}>
          <ArrowRight /> Update status → {nextStage.label}
        </Button>
      ) : null}

      {canScan ? (
        <Button variant="outline" loading={isPending} onClick={rescan}>
          <ScanLine /> Scan
        </Button>
      ) : null}

      <Button asChild variant="outline">
        <Link href={`/orders/${orderId}/tags`}>
          <Printer /> Print tag
        </Link>
      </Button>

      {canUpload ? (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload(file, "DAMAGE");
            }}
          />
          <Button
            variant="outline"
            loading={isPending}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus /> Add photo
          </Button>
        </>
      ) : null}

      {canEdit ? (
        <>
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Pencil /> Edit details
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit {garmentCode}</DialogTitle>
                <DialogDescription>
                  Descriptive details help identify the garment if a tag is lost.
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label="Colour">
                  <Input
                    value={form.color ?? ""}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                  />
                </FormField>
                <FormField label="Brand">
                  <Input
                    value={form.brand ?? ""}
                    onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  />
                </FormField>
                <FormField label="Size">
                  <Input
                    value={form.size ?? ""}
                    onChange={(e) => setForm({ ...form, size: e.target.value })}
                  />
                </FormField>
                <FormField label="Fabric">
                  <Input
                    value={form.fabric ?? ""}
                    onChange={(e) => setForm({ ...form, fabric: e.target.value })}
                  />
                </FormField>
                <FormField label="Stain notes" className="sm:col-span-2">
                  <Textarea
                    value={form.stainNotes ?? ""}
                    onChange={(e) => setForm({ ...form, stainNotes: e.target.value })}
                  />
                </FormField>
                <FormField label="Damage notes" className="sm:col-span-2">
                  <Textarea
                    value={form.damageNotes ?? ""}
                    onChange={(e) => setForm({ ...form, damageNotes: e.target.value })}
                  />
                </FormField>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditOpen(false)}>
                  Cancel
                </Button>
                <Button
                  loading={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await updateGarmentAction({ garmentId, ...form });
                      if (result.ok) {
                        toast.success("Garment updated");
                        setEditOpen(false);
                        router.refresh();
                      } else {
                        toast.error(result.error);
                      }
                    })
                  }
                >
                  Save changes
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={markOpen} onOpenChange={setMarkOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="text-destructive">
                <AlertTriangle /> Flag garment
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Flag {garmentCode}</DialogTitle>
                <DialogDescription>
                  This stops further processing and is written permanently to the
                  garment&apos;s history.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <FormField label="Status" required>
                  <Select value={markStatus} onValueChange={setMarkStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DAMAGED">Damaged</SelectItem>
                      <SelectItem value="LOST">Lost</SelectItem>
                      <SelectItem value="RETURNED">Returned to customer</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="What happened?" required>
                  <Textarea
                    value={markNote}
                    onChange={(event) => setMarkNote(event.target.value)}
                    placeholder="Found torn at the seam during QC…"
                  />
                </FormField>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setMarkOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  loading={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await markGarmentAction({
                        garmentId,
                        status: markStatus,
                        note: markNote,
                      });
                      if (result.ok) {
                        toast.success(`${garmentCode} flagged`);
                        setMarkOpen(false);
                        router.refresh();
                      } else {
                        toast.error(result.error);
                      }
                    })
                  }
                >
                  Flag garment
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}
