"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Phone } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { advancePickupAction, completeDeliveryAction, dispatchDeliveryAction } from "@/app/(app)/delivery/actions";

export interface JobView {
  kind: "pickup" | "delivery";
  id: string;
  number: string;
  orderNumber: string;
  status: string;
  scheduledLabel: string;
  contactName: string;
  contactPhone: string;
  addressLine: string;
  landmark: string | null;
  notes: string | null;
  failureReason: string | null;
}

/** Mobile-first card for one assigned job, with the few actions a Field Manager is allowed. */
export function JobCard({ job, readOnly = false }: { job: JobView; readOnly?: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success(done);
        setNote("");
        router.refresh();
      } else toast.error(result.error ?? "Could not update this job");
    });

  const pickup = (status: "DRIVER_ACCEPTED" | "PICKED_UP" | "FAILED", done: string) =>
    run(() => advancePickupAction({ pickupId: job.id, status, note: note || undefined }), done);
  const complete = (outcome: "DELIVERED" | "FAILED", done: string) =>
    run(
      () => completeDeliveryAction({ deliveryId: job.id, outcome, failureReason: outcome === "FAILED" ? note || "Delivery failed" : undefined, notes: note || undefined, amountCollected: 0 }),
      done,
    );

  const s = job.status;
  const canAccept = job.kind === "pickup" && (s === "DRIVER_ASSIGNED" || s === "REQUESTED");
  const canPick = job.kind === "pickup" && (s === "DRIVER_ACCEPTED" || s === "DRIVER_ASSIGNED");
  const canDispatch = job.kind === "delivery" && (s === "DRIVER_ASSIGNED" || s === "PENDING" || s === "RESCHEDULED");
  const canComplete = job.kind === "delivery" && s === "OUT_FOR_DELIVERY";
  const active = !readOnly && (canAccept || canPick || canDispatch || canComplete);

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold">{job.contactName}</p>
            <p className="text-xs text-muted-foreground">
              {job.number} · Order {job.orderNumber}
            </p>
          </div>
          <div className="text-right">
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{s.replace(/_/g, " ")}</span>
            <p className="mt-1 text-xs text-muted-foreground">{job.scheduledLabel}</p>
          </div>
        </div>

        <p className="flex items-start gap-2 text-sm">
          <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            {job.addressLine}
            {job.landmark ? ` (${job.landmark})` : ""}
          </span>
        </p>
        <a href={`tel:${job.contactPhone}`} className="inline-flex items-center gap-2 text-sm font-medium text-primary">
          <Phone className="size-4" /> {job.contactPhone}
        </a>
        {job.failureReason ? <p className="text-xs text-destructive">Failed: {job.failureReason}</p> : null}
        {job.notes ? <p className="text-xs text-muted-foreground">Note: {job.notes}</p> : null}

        {active ? (
          <div className="space-y-2 border-t pt-3">
            <Input placeholder="Add a note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            <div className="flex flex-wrap gap-2">
              {canAccept ? <Button size="sm" loading={pending} onClick={() => pickup("DRIVER_ACCEPTED", "Pickup accepted")}>Accept</Button> : null}
              {canPick ? <Button size="sm" loading={pending} onClick={() => pickup("PICKED_UP", "Marked picked up")}>Picked up</Button> : null}
              {job.kind === "pickup" ? <Button size="sm" variant="outline" loading={pending} onClick={() => pickup("FAILED", "Marked failed")}>Failed</Button> : null}
              {canDispatch ? (
                <Button size="sm" loading={pending} onClick={() => run(() => dispatchDeliveryAction({ deliveryId: job.id }), "Out for delivery")}>Out for delivery</Button>
              ) : null}
              {canComplete ? <Button size="sm" loading={pending} onClick={() => complete("DELIVERED", "Delivered")}>Delivered</Button> : null}
              {canComplete ? <Button size="sm" variant="outline" loading={pending} onClick={() => complete("FAILED", "Marked failed")}>Failed</Button> : null}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
