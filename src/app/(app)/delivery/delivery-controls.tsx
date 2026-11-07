"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Truck, UserPlus } from "lucide-react";
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
import { formatCurrency } from "@/lib/money";
import {
  advancePickupAction,
  assignDriverAction,
  completeDeliveryAction,
  createDeliveryAction,
  dispatchDeliveryAction,
} from "@/app/(app)/delivery/actions";

export interface DriverOption {
  id: string;
  name: string;
  vehicleNumber: string | null;
}

export function AssignDriverControl({
  jobId,
  jobType,
  drivers,
  currentDriverId,
}: {
  jobId: string;
  jobType: "PICKUP" | "DELIVERY";
  drivers: DriverOption[];
  currentDriverId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (drivers.length === 0) {
    return <span className="text-xs text-muted-foreground">No drivers</span>;
  }

  return (
    <Select
      value={currentDriverId ?? "none"}
      disabled={isPending}
      onValueChange={(driverId) => {
        if (driverId === "none") return;
        startTransition(async () => {
          const result = await assignDriverAction({ jobId, jobType, driverId });
          if (result.ok) {
            toast.success("Driver assigned");
            router.refresh();
          } else {
            toast.error(result.error);
          }
        });
      }}
    >
      <SelectTrigger className="h-8 w-40 text-xs">
        <SelectValue placeholder="Assign driver" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Unassigned</SelectItem>
        {drivers.map((driver) => (
          <SelectItem key={driver.id} value={driver.id}>
            {driver.name}
            {driver.vehicleNumber ? ` · ${driver.vehicleNumber}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PickupStatusControl({
  pickupId,
  status,
}: {
  pickupId: string;
  status: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const NEXT: Record<string, { value: string; label: string } | undefined> = {
    REQUESTED: { value: "DRIVER_ACCEPTED", label: "Accept" },
    DRIVER_ASSIGNED: { value: "DRIVER_ACCEPTED", label: "Accept" },
    DRIVER_ACCEPTED: { value: "PICKED_UP", label: "Mark picked up" },
    PICKED_UP: { value: "RECEIVED_AT_LAUNDRY", label: "Received at laundry" },
  };

  const next = NEXT[status];
  if (!next) return null;

  return (
    <Button
      size="sm"
      variant="outline"
      loading={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await advancePickupAction({
            pickupId,
            status: next.value,
          });
          if (result.ok) {
            toast.success(next.label);
            router.refresh();
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      {next.label}
    </Button>
  );
}

export function DispatchControl({ deliveryId }: { deliveryId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      loading={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await dispatchDeliveryAction({ deliveryId });
          if (result.ok) {
            toast.success("Out for delivery");
            router.refresh();
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      <Truck /> Dispatch
    </Button>
  );
}

export function CompleteDeliveryDialog({
  deliveryId,
  deliveryNumber,
  amountToCollect,
  canCollect,
  trigger,
}: {
  deliveryId: string;
  deliveryNumber: string;
  amountToCollect: number;
  canCollect: boolean;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState("DELIVERED");
  const [receivedByName, setReceivedByName] = useState("");
  const [amountCollected, setAmountCollected] = useState(amountToCollect);
  const [collectionMethod, setCollectionMethod] = useState("CASH");
  const [failureReason, setFailureReason] = useState("");
  const [rescheduledFor, setRescheduledFor] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm">Complete</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close out {deliveryNumber}</DialogTitle>
          <DialogDescription>
            {amountToCollect > 0
              ? `${formatCurrency(amountToCollect)} is due on this order.`
              : "Nothing is outstanding on this order."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <FormField label="Outcome" required>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DELIVERED">Delivered</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
                <SelectItem value="RESCHEDULED">Rescheduled</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          {outcome === "DELIVERED" ? (
            <>
              <FormField label="Received by">
                <Input
                  value={receivedByName}
                  onChange={(event) => setReceivedByName(event.target.value)}
                  placeholder="Name of the person who took delivery"
                />
              </FormField>

              {canCollect && amountToCollect > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField label="Amount collected ₹">
                    <Input
                      type="number"
                      min={0}
                      max={amountToCollect}
                      step="0.01"
                      value={amountCollected}
                      onChange={(event) =>
                        setAmountCollected(Math.max(0, Number(event.target.value) || 0))
                      }
                    />
                  </FormField>
                  <FormField label="Method">
                    <Select value={collectionMethod} onValueChange={setCollectionMethod}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CASH">Cash</SelectItem>
                        <SelectItem value="UPI">UPI</SelectItem>
                        <SelectItem value="CARD">Card</SelectItem>
                        <SelectItem value="ONLINE">Online</SelectItem>
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormField>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <FormField label="What went wrong?" required>
                <Textarea
                  value={failureReason}
                  onChange={(event) => setFailureReason(event.target.value)}
                  placeholder="Customer not at home…"
                />
              </FormField>
              {outcome === "RESCHEDULED" ? (
                <FormField label="New date & time" required>
                  <Input
                    type="datetime-local"
                    value={rescheduledFor}
                    onChange={(event) => setRescheduledFor(event.target.value)}
                  />
                </FormField>
              ) : null}
            </>
          )}

          <FormField label="Notes">
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
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
                const result = await completeDeliveryAction({
                  deliveryId,
                  outcome,
                  receivedByName,
                  amountCollected: outcome === "DELIVERED" ? amountCollected : 0,
                  collectionMethod,
                  failureReason,
                  rescheduledFor: rescheduledFor || null,
                  notes,
                });
                if (result.ok) {
                  toast.success(`${deliveryNumber} closed as ${outcome.toLowerCase()}`);
                  setOpen(false);
                  router.refresh();
                } else {
                  toast.error(result.error);
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

export function ScheduleDeliveryDialog({
  orders,
  drivers,
}: {
  orders: {
    id: string;
    orderNumber: string;
    customerName: string;
    customerPhone: string;
    addressLine: string | null;
    outstandingAmount: number;
  }[];
  drivers: DriverOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [orderId, setOrderId] = useState(orders[0]?.id ?? "");
  const [scheduledAt, setScheduledAt] = useState("");
  const [driverId, setDriverId] = useState("none");
  const [notes, setNotes] = useState("");

  const order = orders.find((candidate) => candidate.id === orderId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> Schedule delivery
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule a delivery</DialogTitle>
          <DialogDescription>
            Only orders that are ready for handover are listed.
          </DialogDescription>
        </DialogHeader>

        {orders.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No orders are ready for delivery right now.
          </p>
        ) : (
          <div className="space-y-3">
            <FormField label="Order" required>
              <Select value={orderId} onValueChange={setOrderId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {orders.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.orderNumber} · {option.customerName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField label="Scheduled for" required>
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
            </FormField>

            <FormField label="Driver">
              <Select value={driverId} onValueChange={setDriverId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Assign later</SelectItem>
                  {drivers.map((driver) => (
                    <SelectItem key={driver.id} value={driver.id}>
                      {driver.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            {order ? (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                <p className="font-medium">{order.customerName}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {order.customerPhone}
                </p>
                <p className="text-xs text-muted-foreground">
                  {order.addressLine ?? "No address on file — add one on the order"}
                </p>
                <p className="mt-1 text-xs">
                  To collect:{" "}
                  <span className="font-semibold numeric">
                    {formatCurrency(order.outstandingAmount)}
                  </span>
                </p>
              </div>
            ) : null}

            <FormField label="Notes">
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
            </FormField>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            loading={isPending}
            disabled={!order || !scheduledAt}
            onClick={() =>
              startTransition(async () => {
                if (!order) return;
                const result = await createDeliveryAction({
                  orderId: order.id,
                  scheduledAt,
                  contactName: order.customerName,
                  contactPhone: order.customerPhone,
                  addressLine: order.addressLine ?? "",
                  driverId: driverId === "none" ? null : driverId,
                  isPartial: false,
                  notes,
                });
                if (result.ok) {
                  toast.success(`${result.data.deliveryNumber} scheduled`);
                  setOpen(false);
                  router.refresh();
                } else {
                  toast.error(result.error);
                }
              })
            }
          >
            Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
