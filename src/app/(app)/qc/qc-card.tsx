"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { qcDecisionAction } from "@/app/(app)/qc/actions";

export interface QcGarmentView {
  id: string;
  code: string;
  title: string;
  service: string;
  orderNumber: string;
  status: string;
  reworkCount: number;
  lastNote: string | null;
}

export function QcCard({ garment, mode }: { garment: QcGarmentView; mode: "inspect" | "rework" }) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  const decide = (decision: "PASS" | "FAIL" | "REWORK", done: string) =>
    startTransition(async () => {
      const result = await qcDecisionAction({ garmentId: garment.id, decision, notes: notes || undefined });
      if (result.ok) {
        toast.success(done);
        setNotes("");
        router.refresh();
      } else toast.error(result.error);
    });

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-mono text-sm font-semibold">{garment.code}</p>
            <p className="text-sm">{garment.title}</p>
            <p className="text-xs text-muted-foreground">{garment.service} · Order {garment.orderNumber}</p>
          </div>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{garment.status.replace(/_/g, " ")}</span>
        </div>
        {garment.reworkCount > 0 ? <p className="text-xs text-amber-700">Reworked {garment.reworkCount}×</p> : null}
        {garment.lastNote ? <p className="text-xs text-muted-foreground">Last note: {garment.lastNote}</p> : null}

        {mode === "inspect" ? (
          <div className="space-y-2 border-t pt-3">
            <Input placeholder="Inspection notes (required to fail)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
            <div className="flex gap-2">
              <Button size="sm" loading={pending} onClick={() => decide("PASS", "QC passed")}>Pass</Button>
              <Button size="sm" variant="destructive" loading={pending} onClick={() => decide("FAIL", "Marked QC failed")}>Fail</Button>
            </div>
          </div>
        ) : garment.status === "QC_FAILED" ? (
          <div className="space-y-2 border-t pt-3">
            <Input placeholder="Rework instructions (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
            <Button size="sm" loading={pending} onClick={() => decide("REWORK", "Sent for rework")}>Send for rework</Button>
          </div>
        ) : (
          <p className="border-t pt-3 text-xs text-muted-foreground">In rework — it returns to the QC queue after the stations finish.</p>
        )}
      </CardContent>
    </Card>
  );
}
