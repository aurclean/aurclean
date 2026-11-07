"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Printer,
  Send,
  CheckCircle,
  Clock,
  ArrowLeft,
  AlertTriangle,
  Ban,
} from "lucide-react";

import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { CHALLAN_STATUS_LABELS } from "@/lib/workflow";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { updateChallanStatusAction, cancelChallanAction } from "../actions";
import { DocumentActionBar } from "@/components/documents/document-action-bar";
import type { ChallanStatus, PaymentMethod } from "@/generated/prisma/client";

interface ChallanItem {
  id: string;
  garmentCode: string;
  category: string;
  description: string;
  service: string;
  quantity: number;
  unitPrice: unknown;
  amount: unknown;
}

interface StatusHistoryEntry {
  id: string;
  toStatus: string;
  note: string | null;
  createdAt: Date;
  userName: string | null;
}

interface ChallanDetail {
  id: string;
  challanNumber: string;
  status: ChallanStatus;
  createdAt: Date;
  customerName: string;
  customerPhone: string;
  customerAddress: string | null;
  customer: { id: string } | null;
  expectedDeliveryDate: Date | null;
  grandTotal: unknown;
  paidAmount: unknown;
  balanceAmount: unknown;
  paymentStatus: string;
  deliveredByName: string | null;
  receivedByName: string | null;
  items: ChallanItem[];
  statusHistory: StatusHistoryEntry[];
  order: {
    id: string;
    orderNumber: string;
    placedAt: Date;
    totalPieces: number | null;
    garments?: unknown[];
  };
}

interface Props {
  challan: ChallanDetail;
}

export function ChallanDetailsClient({ challan }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const [deliverModalOpen, setDeliverModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);

  const [collectPayment, setCollectPayment] = useState(Number(challan.balanceAmount) > 0);
  const [paymentAmount, setPaymentAmount] = useState<number>(Number(challan.balanceAmount));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [deliveredBy, setDeliveredBy] = useState(challan.deliveredByName || "");
  const [receivedBy, setReceivedBy] = useState(challan.receivedByName || challan.customerName);

  const [cancelReason, setCancelReason] = useState("");

  const handleMarkReady = async () => {
    setLoading(true);
    try {
      const res = await updateChallanStatusAction(challan.id, "READY_FOR_DELIVERY");
      if (res.success) {
        toast.success("Delivery Challan marked as Ready for Delivery!");
        router.refresh();
      } else {
        toast.error(res.error || "Failed to update status");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Status update error");
    } finally {
      setLoading(false);
    }
  };

  const handleMarkDelivered = async () => {
    setLoading(true);
    try {
      const res = await updateChallanStatusAction(challan.id, "DELIVERED", {
        deliveredByName: deliveredBy,
        receivedByName: receivedBy,
        paymentAmount: collectPayment ? paymentAmount : 0,
        paymentMethod: collectPayment ? paymentMethod : undefined,
      });

      if (res.success) {
        toast.success("Delivery Challan marked as Delivered!");
        setDeliverModalOpen(false);
        router.refresh();
      } else {
        toast.error(res.error || "Failed to mark delivered");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delivery error");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelChallan = async () => {
    if (!cancelReason.trim()) {
      toast.error("Please provide a reason for cancelling this challan.");
      return;
    }

    setLoading(true);
    try {
      const res = await cancelChallanAction(challan.id, cancelReason);
      if (res.success) {
        toast.success("Delivery Challan cancelled.");
        setCancelModalOpen(false);
        router.refresh();
      } else {
        toast.error(res.error || "Failed to cancel challan");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cancellation error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Button asChild variant="outline" size="sm">
            <Link href="/delivery-challans">
              <ArrowLeft /> Back to Challans
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-mono text-2xl font-bold tracking-tight">{challan.challanNumber}</h1>
              <StatusBadge status={challan.status} label={CHALLAN_STATUS_LABELS[challan.status]} dot />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Order:{" "}
              <Link href={`/orders/${challan.order.id}`} className="font-semibold text-primary hover:underline">
                {challan.order.orderNumber}
              </Link>{" "}
              · Created {formatDate(challan.createdAt)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DocumentActionBar
            documentType="DELIVERY_CHALLAN"
            documentId={challan.id}
            documentNumber={challan.challanNumber}
            customerPhone={challan.customerPhone}
            customerName={challan.customerName}
            orderNumber={challan.order.orderNumber}
            pdfUrl={`/api/documents/pdf?type=DELIVERY_CHALLAN&id=${challan.id}`}
          />

          {challan.status === "GENERATED" ? (
            <Button onClick={handleMarkReady} loading={loading} size="sm">
              <Clock /> Mark Ready for Delivery
            </Button>
          ) : null}

          {["GENERATED", "READY_FOR_DELIVERY", "PARTIALLY_DELIVERED"].includes(challan.status) ? (
            <Button onClick={() => setDeliverModalOpen(true)} disabled={loading} size="sm">
              <CheckCircle /> Deliver Order
            </Button>
          ) : null}

          {challan.status !== "DELIVERED" && challan.status !== "CANCELLED" ? (
            <Button onClick={() => setCancelModalOpen(true)} variant="outline" size="sm" className="text-destructive">
              <Ban /> Cancel
            </Button>
          ) : null}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Customer &amp; Address
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-base font-semibold">{challan.customerName}</p>
            <p className="text-sm font-medium text-primary">{challan.customerPhone}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {challan.customerAddress || "Address not provided"}
            </p>
            {challan.customer ? (
              <Link
                href={`/customers/${challan.customer.id}`}
                className="inline-block pt-2 text-xs font-semibold text-primary hover:underline"
              >
                View Customer Profile →
              </Link>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Linked Order
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Order Number</span>
              <span className="font-semibold">{challan.order.orderNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Order Date</span>
              <span className="font-medium">{formatDate(challan.order.placedAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expected Delivery</span>
              <span className="font-medium">{formatDate(challan.expectedDeliveryDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Order Pieces</span>
              <span className="font-semibold">
                {challan.order.totalPieces || challan.order.garments?.length || 0}
              </span>
            </div>
            <Link
              href={`/orders/${challan.order.id}`}
              className="inline-block pt-2 text-xs font-semibold text-primary hover:underline"
            >
              Open Order Details →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Payment Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Challan Amount</span>
              <span className="font-semibold">{formatCurrency(Number(challan.grandTotal))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Paid Amount</span>
              <span className="font-semibold text-success">{formatCurrency(Number(challan.paidAmount))}</span>
            </div>
            <div className="flex justify-between border-t border-dashed border-border pt-1.5 text-sm font-bold">
              <span>Balance Due</span>
              <span className={Number(challan.balanceAmount) > 0 ? "text-warning-foreground" : "text-success"}>
                {formatCurrency(Number(challan.balanceAmount))}
              </span>
            </div>
            <div className="pt-2">
              <StatusBadge
                status={challan.paymentStatus}
                label={`Payment ${challan.paymentStatus.replace(/_/g, " ")}`}
                className="w-full justify-center"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Garment items */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border bg-muted/40 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Garments Included in Delivery ({challan.items.length})
          </h3>
          <span className="text-xs text-muted-foreground">
            {challan.items.length === challan.order.garments?.length
              ? "Full Delivery"
              : `Partial Delivery (${challan.items.length} of ${challan.order.garments?.length ?? 0})`}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40 font-semibold text-muted-foreground">
                <th className="px-4 py-2.5">#</th>
                <th className="px-4 py-2.5">Garment ID</th>
                <th className="px-4 py-2.5">Category</th>
                <th className="px-4 py-2.5">Description</th>
                <th className="px-4 py-2.5">Service</th>
                <th className="px-4 py-2.5 text-center">Qty</th>
                <th className="px-4 py-2.5 text-right">Unit Price</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {challan.items.map((item, idx) => (
                <tr key={item.id} className="hover:bg-accent/40">
                  <td className="px-4 py-2.5 text-muted-foreground">{idx + 1}</td>
                  <td className="px-4 py-2.5 font-mono font-semibold">{item.garmentCode}</td>
                  <td className="px-4 py-2.5 font-medium">{item.category}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{item.description}</td>
                  <td className="px-4 py-2.5">{item.service}</td>
                  <td className="px-4 py-2.5 text-center font-semibold">{item.quantity}</td>
                  <td className="px-4 py-2.5 text-right">{formatCurrency(Number(item.unitPrice))}</td>
                  <td className="px-4 py-2.5 text-right font-semibold">{formatCurrency(Number(item.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Status history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Challan Status History &amp; Audit Log
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {challan.statusHistory.map((hist) => (
            <div key={hist.id} className="border-l-2 border-primary py-1 pl-3 text-xs">
              <p className="font-semibold">
                Status changed to{" "}
                <span className="uppercase text-primary">{hist.toStatus.replace(/_/g, " ")}</span>
              </p>
              {hist.note ? <p className="mt-0.5 text-muted-foreground">{hist.note}</p> : null}
              <p className="mt-1 text-[10px] text-muted-foreground">
                {formatDate(hist.createdAt)} · {hist.userName || "System Operator"}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Mark Delivered Modal */}
      <Dialog open={deliverModalOpen} onOpenChange={setDeliverModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="size-5 text-success" /> Deliver Order &amp; Complete Challan
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-3">
              <p>
                <span className="font-semibold">Customer:</span> {challan.customerName}
              </p>
              <p>
                <span className="font-semibold">Order No:</span> {challan.order.orderNumber}
              </p>
              <p>
                <span className="font-semibold">Garments:</span> {challan.items.length} items
              </p>
              <p>
                <span className="font-semibold">Challan Total:</span>{" "}
                {formatCurrency(Number(challan.grandTotal))}
              </p>
            </div>

            {Number(challan.balanceAmount) > 0 ? (
              <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-warning-foreground">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <AlertTriangle className="size-4" /> Payment Pending:{" "}
                  {formatCurrency(Number(challan.balanceAmount))}
                </div>

                <label className="flex items-center gap-2 pt-1">
                  <Checkbox
                    checked={collectPayment}
                    onCheckedChange={(checked) => setCollectPayment(checked === true)}
                  />
                  <span className="cursor-pointer font-medium">Collect Payment now upon delivery</span>
                </label>

                {collectPayment ? (
                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <div>
                      <Label className="text-[11px]">Amount to Collect (₹)</Label>
                      <Input
                        type="number"
                        value={paymentAmount}
                        onChange={(event) => setPaymentAmount(parseFloat(event.target.value) || 0)}
                        className="h-8 text-xs font-semibold"
                      />
                    </div>
                    <div>
                      <Label className="text-[11px]">Payment Method</Label>
                      <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CASH">Cash</SelectItem>
                          <SelectItem value="UPI">UPI</SelectItem>
                          <SelectItem value="CARD">Card</SelectItem>
                          <SelectItem value="ONLINE">Online</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[11px]">Delivered By</Label>
                <Input
                  value={deliveredBy}
                  onChange={(event) => setDeliveredBy(event.target.value)}
                  placeholder="Driver / Courier Name"
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <Label className="text-[11px]">Received By</Label>
                <Input
                  value={receivedBy}
                  onChange={(event) => setReceivedBy(event.target.value)}
                  placeholder="Customer Name"
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeliverModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleMarkDelivered} loading={loading}>
              Confirm Delivery
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Challan Modal */}
      <Dialog open={cancelModalOpen} onOpenChange={setCancelModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Ban className="size-5" /> Cancel Delivery Challan
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <p className="text-muted-foreground">
              Are you sure you want to cancel Delivery Challan{" "}
              <span className="font-semibold text-foreground">{challan.challanNumber}</span>? Finalized
              delivery challans will be retained in history as cancelled.
            </p>

            <div>
              <Label className="text-[11px] font-semibold">Reason for Cancellation</Label>
              <Textarea
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder="Specify why this delivery challan is being cancelled…"
                className="mt-1 h-20 text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelModalOpen(false)}>
              Back
            </Button>
            <Button variant="destructive" onClick={handleCancelChallan} loading={loading}>
              Confirm Cancellation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
