"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signalDataChange } from "@/components/shared/live-refresh";

import { cancelDeliveryAction, cancelPickupAction } from "./actions";

/**
 * Calling off a run. Deliveries are jobs rather than documents, so this marks
 * the attempt cancelled and leaves it visible on the order rather than
 * removing it.
 */
export function CancelDeliveryButton({
  deliveryId,
  pickupId,
  deliveryNumber,
  compact = false,
}: {
  deliveryId?: string;
  pickupId?: string;
  deliveryNumber: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const isPickup = Boolean(pickupId);

  return (
    <>
      <Button
        variant={compact ? "ghost" : "outline"}
        size={compact ? "icon-sm" : "default"}
        className="text-destructive hover:bg-destructive/10"
        onClick={() => setOpen(true)}
        aria-label={`Cancel ${deliveryNumber}`}
      >
        <XCircle />
        {compact ? null : "Cancel run"}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel “{deliveryNumber}”?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  The {isPickup ? "pickup" : "delivery"} is marked cancelled and stays on
                  the order so the attempt is still visible. The order itself and its
                  garments are untouched.
                </p>
                <p>Schedule a fresh run when you know the new time.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Why?</Label>
            <Input
              id="cancel-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Customer asked to reschedule"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              className={buttonVariants({ variant: "destructive" })}
              onClick={(event) => {
                event.preventDefault();
                startTransition(async () => {
                  const result = isPickup
                    ? await cancelPickupAction({ pickupId, reason: reason || undefined })
                    : await cancelDeliveryAction({
                        deliveryId,
                        reason: reason || undefined,
                      });
                  if (result.ok) {
                    toast.success(`${deliveryNumber} cancelled`);
                    setOpen(false);
                    signalDataChange();
                    router.refresh();
                  } else {
                    toast.error(result.error);
                  }
                });
              }}
            >
              {pending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" /> Cancelling…
                </>
              ) : (
                "Cancel run"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
