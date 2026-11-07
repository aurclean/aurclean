"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus, Printer, Send, CheckCircle, Eye, Truck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatCurrency } from "@/lib/money";
import { CHALLAN_STATUS_LABELS } from "@/lib/workflow";
import { toast } from "sonner";
import { createDeliveryChallanAction, updateChallanStatusAction } from "@/app/(app)/delivery-challans/actions";
import { sendDocumentWhatsAppAction } from "@/app/api/documents/actions";
import { formatWhatsAppPhone } from "@/lib/whatsapp-templates";
import type { ChallanStatus } from "@/generated/prisma/client";

interface ChallanSummary {
  id: string;
  challanNumber: string;
  status: ChallanStatus;
  grandTotal: number;
  balanceAmount: number;
}

interface Props {
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  challans: ChallanSummary[];
  canManage: boolean;
}

export function OrderDeliveryChallanSection({
  orderId,
  orderNumber: _orderNumber,
  customerName,
  customerPhone,
  challans,
  canManage,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [sendingWa, setSendingWa] = useState(false);

  const activeChallan = challans.find((c) => c.status !== "CANCELLED") || challans[0];

  const handleCreateChallan = async () => {
    setLoading(true);
    try {
      const res = await createDeliveryChallanAction({
        orderId,
        deliveredByName: "Laundry Dispatch",
        receivedByName: customerName,
      });

      if (res.success) {
        toast.success(`Delivery Challan ${res.challanNumber} created!`);
        router.refresh();
      } else {
        toast.error(res.error || "Failed to create Delivery Challan");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error creating challan");
    } finally {
      setLoading(false);
    }
  };

  const handleWhatsApp = async (challanId: string) => {
    setSendingWa(true);
    try {
      const res = await sendDocumentWhatsAppAction({
        documentType: "DELIVERY_CHALLAN",
        documentId: challanId,
      });
      if (res.success) {
        toast.success(`Delivery Challan sent to ${customerPhone} via WhatsApp!`);
      } else {
        const fallbackUrl = `https://wa.me/${formatWhatsAppPhone(customerPhone)}?text=${encodeURIComponent(`Hello ${customerName},\n\nPlease find your Delivery Challan attached.\nOrder #${_orderNumber}\n\nThank you.`)}`;

        toast.error("OpenWA Gateway Endpoint Unavailable", {
          description: "Click below to send via WhatsApp Web / App directly",
          action: {
            label: "Open WhatsApp Web ↗",
            onClick: () => window.open(fallbackUrl, "_blank"),
          },
          duration: 10000,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "WhatsApp delivery error");
    } finally {
      setSendingWa(false);
    }
  };

  const handleMarkDelivered = async (challanId: string) => {
    setLoading(true);
    try {
      const res = await updateChallanStatusAction(challanId, "DELIVERED");
      if (res.success) {
        toast.success("Marked as Delivered!");
        router.refresh();
      } else {
        toast.error(res.error || "Failed to update status");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delivery update error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <FileText className="size-4 text-primary" /> Delivery Challan
        </CardTitle>
        {canManage && !activeChallan ? (
          <Button onClick={handleCreateChallan} loading={loading} size="sm">
            <Plus /> Create Delivery Challan
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {!activeChallan ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 py-4 text-center">
            <Truck className="mx-auto mb-1 size-8 text-muted-foreground/50" />
            <p className="text-xs font-medium text-muted-foreground">
              No active Delivery Challan generated for this order yet.
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Generate a formal challan before sending garments for delivery.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
              <div>
                <p className="font-mono text-sm font-semibold">{activeChallan.challanNumber}</p>
                <p className="mt-0.5 text-muted-foreground">
                  Total: <span className="font-semibold text-foreground">{formatCurrency(activeChallan.grandTotal)}</span>{" "}
                  · Balance:{" "}
                  <span className="font-semibold text-warning-foreground">
                    {formatCurrency(activeChallan.balanceAmount)}
                  </span>
                </p>
              </div>
              <StatusBadge status={activeChallan.status} label={CHALLAN_STATUS_LABELS[activeChallan.status]} dot />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/delivery-challans/${activeChallan.id}`}>
                  <Eye /> View Challan
                </Link>
              </Button>

              <Button asChild variant="outline" size="sm">
                <a
                  href={`/api/documents/pdf?type=DELIVERY_CHALLAN&id=${activeChallan.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Printer /> Print / PDF
                </a>
              </Button>

              <Button onClick={() => handleWhatsApp(activeChallan.id)} loading={sendingWa} variant="outline" size="sm">
                <Send /> WhatsApp Challan
              </Button>

              {activeChallan.status !== "DELIVERED" && canManage ? (
                <Button onClick={() => handleMarkDelivered(activeChallan.id)} loading={loading} size="sm">
                  <CheckCircle /> Mark Delivered
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
