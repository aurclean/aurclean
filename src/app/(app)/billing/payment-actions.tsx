"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Ban, Loader2 } from "lucide-react";
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

import { voidPaymentAction } from "./actions";

/**
 * Voiding a payment recorded in error. The row is kept and marked cancelled so
 * the till still reconciles — this is a correction, not an erasure.
 */
export function VoidPaymentButton({
  paymentId,
  paymentNumber,
  amount,
}: {
  paymentId: string;
  paymentNumber: string;
  amount: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button
        variant="outline"
        className="text-destructive hover:bg-destructive/10"
        onClick={() => setOpen(true)}
      >
        <Ban /> Void
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void “{paymentNumber}”?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  {amount} comes back off the order and its balance goes up again. The
                  payment stays on the record marked cancelled, so the till still
                  reconciles.
                </p>
                <p>Use a refund instead if the money actually went back to the customer.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="void-reason">Why?</Label>
            <Input
              id="void-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Entered twice at the counter"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              className={buttonVariants({ variant: "destructive" })}
              onClick={(event) => {
                event.preventDefault();
                startTransition(async () => {
                  const result = await voidPaymentAction({
                    paymentId,
                    reason: reason || undefined,
                  });
                  if (result.ok) {
                    toast.success(`${paymentNumber} voided`);
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
                  <Loader2 className="mr-2 size-4 animate-spin" /> Voiding…
                </>
              ) : (
                "Void payment"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
