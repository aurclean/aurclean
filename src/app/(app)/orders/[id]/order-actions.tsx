"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Ban, ChevronDown, Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { signalDataChange } from "@/components/shared/live-refresh";

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/shared/form-field";
import { formatCurrency } from "@/lib/money";
import { humanize } from "@/lib/utils";
import {
  cancelOrderAction,
  rewashOrderAction,
  setOrderStatusAction,
} from "@/app/(app)/orders/actions";

interface OrderActionsProps {
  orderId: string;
  orderNumber: string;
  status: string;
  paidAmount: number;
  totalAmount: number;
  outstandingAmount: number;
  requireFullPaymentBeforeDelivery: boolean;
  allowedStatuses: string[];
  canUpdate: boolean;
  canCancel: boolean;
  canRefund: boolean;
}

export function OrderActions({
  orderId,
  orderNumber,
  status,
  paidAmount,
  totalAmount,
  outstandingAmount,
  requireFullPaymentBeforeDelivery,
  allowedStatuses,
  canUpdate,
  canCancel,
  canRefund,
}: OrderActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rewashOpen, setRewashOpen] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [deliveredOpen, setDeliveredOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [refundAmount, setRefundAmount] = useState(0);
  const [rewashReason, setRewashReason] = useState("");

  const changeStatus = (next: string, onDone?: () => void) => {
    startTransition(async () => {
      const result = await setOrderStatusAction({ orderId, status: next });
      if (result.ok) {
        toast.success(`${orderNumber} moved to ${humanize(next)}`);
        signalDataChange();
        router.refresh();
        onDone?.();
        if (next === "DELIVERED") setDeliveredOpen(true);
      } else {
        toast.error(result.error);
      }
    });
  };

  const selectStatus = (next: string) => {
    if (next === "DELIVERED") {
      setDeliverOpen(true);
      return;
    }
    changeStatus(next);
  };

  const blockedByPolicy = requireFullPaymentBeforeDelivery && outstandingAmount > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canUpdate && allowedStatuses.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" loading={isPending}>
              Move status <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Currently {humanize(status)}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {allowedStatuses.map((next) => (
              <DropdownMenuItem key={next} onSelect={() => selectStatus(next)}>
                {humanize(next)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {canUpdate ? (
        <Dialog open={rewashOpen} onOpenChange={setRewashOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">
              <RefreshCw /> Rewash
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Send {orderNumber} for rewash</DialogTitle>
              <DialogDescription>
                Every garment on this order returns to the washing queue and any
                rack assignment is released.
              </DialogDescription>
            </DialogHeader>
            <FormField label="Reason" required>
              <Textarea
                value={rewashReason}
                onChange={(event) => setRewashReason(event.target.value)}
                placeholder="Customer reported detergent smell…"
              />
            </FormField>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRewashOpen(false)}>
                Cancel
              </Button>
              <Button
                loading={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await rewashOrderAction(
                      orderId,
                      rewashReason,
                    );
                    if (result.ok) {
                      toast.success(
                        `${result.data.count} garments queued for rewash`,
                      );
                      setRewashOpen(false);
                      setRewashReason("");
                      signalDataChange();
                      router.refresh();
                    } else {
                      toast.error(result.error);
                    }
                  })
                }
              >
                Confirm rewash
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {canCancel ? (
        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="text-destructive">
              <Ban /> Cancel
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancel {orderNumber}</DialogTitle>
              <DialogDescription>
                Processing stops immediately and open tasks are abandoned. This
                cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <FormField label="Reason" required>
                <Textarea
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  placeholder="Customer withdrew the order…"
                />
              </FormField>
              {canRefund && paidAmount > 0 ? (
                <FormField
                  label="Refund amount ₹"
                  hint={`Up to ₹${paidAmount.toFixed(2)} has been collected`}
                >
                  <Input
                    type="number"
                    min={0}
                    max={paidAmount}
                    step="0.01"
                    value={refundAmount}
                    onChange={(event) =>
                      setRefundAmount(
                        Math.max(0, Number(event.target.value) || 0),
                      )
                    }
                  />
                </FormField>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancelOpen(false)}>
                Keep order
              </Button>
              <Button
                variant="destructive"
                loading={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await cancelOrderAction({
                      orderId,
                      reason: cancelReason,
                      refundAmount,
                    });
                    if (result.ok) {
                      toast.success(`${orderNumber} cancelled`);
                      setCancelOpen(false);
                      signalDataChange();
                      router.refresh();
                    } else {
                      toast.error(result.error);
                    }
                  })
                }
              >
                Cancel order
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      <Dialog open={deliverOpen} onOpenChange={setDeliverOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deliver {orderNumber}</DialogTitle>
            <DialogDescription>
              Confirm the order summary before handing the garments over.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total</span>
              <span className="font-medium">{formatCurrency(totalAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Paid</span>
              <span className="font-medium">{formatCurrency(paidAmount)}</span>
            </div>
            <div className="flex justify-between border-t border-dashed border-border pt-2">
              <span className="text-muted-foreground">Balance</span>
              <span className={outstandingAmount > 0 ? "font-semibold text-destructive" : "font-semibold"}>
                {formatCurrency(outstandingAmount)}
              </span>
            </div>
          </div>

          {outstandingAmount > 0 ? (
            <div className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-sm text-warning-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>
                {formatCurrency(outstandingAmount)} balance remaining.{" "}
                {blockedByPolicy
                  ? "Business policy requires full payment before delivery — collect the balance to continue."
                  : "You can collect it now or deliver and settle the balance later."}
              </p>
            </div>
          ) : null}

          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <Button variant="outline" onClick={() => setDeliverOpen(false)}>
              Cancel
            </Button>
            <div className="flex flex-wrap gap-2">
              {outstandingAmount > 0 ? (
                <Button asChild variant="outline">
                  <Link href={`/billing/collect?order=${orderId}`}>Collect payment</Link>
                </Button>
              ) : null}
              <Button
                loading={isPending}
                disabled={blockedByPolicy}
                onClick={() => changeStatus("DELIVERED", () => setDeliverOpen(false))}
              >
                {outstandingAmount > 0 ? "Deliver with balance" : "Confirm delivery"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deliveredOpen} onOpenChange={setDeliveredOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{orderNumber} delivered</DialogTitle>
            <DialogDescription>
              Hand the customer a delivery receipt for their records.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeliveredOpen(false)}>
              Close
            </Button>
            <Button asChild onClick={() => setDeliveredOpen(false)}>
              <Link href={`/orders/${orderId}/receipt`}>
                <Printer /> Print delivery receipt
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
