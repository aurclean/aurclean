"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, FileText, Loader2, MessageSquare, Send, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatWhatsAppPhone, interpolateWhatsAppTemplate } from "@/lib/whatsapp-templates";
import type { WhatsAppMessageType } from "@/generated/prisma/client";

import { sendWhatsAppAction } from "@/app/(app)/settings/whatsapp/actions";

export interface WhatsAppComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerName: string;
  phone: string;
  customerId?: string;
  orderId?: string;
  orderNumber?: string;
  totalAmount?: number;
  paidAmount?: number;
  outstandingAmount?: number;
  deliveryDate?: string | Date;
  initialType?: WhatsAppMessageType;
  documentName?: string;
  documentBase64?: string;
  businessName: string;
}

const TYPE_OPTIONS: Array<{ value: WhatsAppMessageType; label: string; icon: string }> = [
  { value: "INVOICE", label: "Invoice", icon: "📄" },
  { value: "PAYMENT_RECEIPT", label: "Payment Receipt", icon: "💳" },
  { value: "DELIVERY_RECEIPT", label: "Delivery Receipt", icon: "🚚" },
  { value: "ORDER_READY", label: "Order Ready", icon: "✨" },
  { value: "PAYMENT_PENDING", label: "Payment Reminder", icon: "⏳" },
  { value: "ORDER_CREATED", label: "Order Created", icon: "📦" },
  { value: "ORDER_DELIVERED", label: "Order Delivered", icon: "🎉" },
  { value: "CUSTOM", label: "Custom Message", icon: "💬" },
];

export function WhatsAppComposerDialog({
  open,
  onOpenChange,
  customerName,
  phone,
  customerId,
  orderId,
  orderNumber,
  totalAmount = 0,
  paidAmount = 0,
  outstandingAmount = 0,
  deliveryDate,
  initialType = "INVOICE",
  documentName,
  documentBase64,
  businessName,
}: WhatsAppComposerProps) {
  const [messageType, setMessageType] = useState<WhatsAppMessageType>(initialType);
  const [customText, setCustomText] = useState("");
  const [pending, startTransition] = useTransition();

  const getTemplateBody = (type: WhatsAppMessageType) => {
    switch (type) {
      case "INVOICE":
        return "Hi {{customerName}},\n\nThank you for choosing {{businessName}}.\n\nInvoice #{{invoiceNumber}}\nOrder #{{orderId}}\nTotal: {{total}}\nPaid: {{paid}}\nBalance: {{balance}}\n\nPlease find your invoice attached.\n\nThank you,\n{{businessName}}";
      case "PAYMENT_RECEIPT":
        return "Hi {{customerName}},\n\nPayment Receipt #{{invoiceNumber}}\nOrder #{{orderId}}\nAmount Paid: {{paid}}\nRemaining Balance: {{balance}}\n\nPlease find your payment receipt attached.\n\nThank you,\n{{businessName}}";
      case "DELIVERY_RECEIPT":
        return "Hi {{customerName}},\n\nDelivery Receipt for Order #{{orderId}}.\nTotal Amount: {{total}}\nBalance: {{balance}}\n\nPlease find your delivery receipt attached.\n\nThank you for choosing {{businessName}}";
      case "ORDER_READY":
        return "Hi {{customerName}},\n\nYour {{businessName}} laundry order #{{orderId}} is ready for collection.\n\nTotal: {{total}}\nPaid: {{paid}}\nBalance Due: {{balance}}\n\nThank you,\n{{businessName}}";
      case "PAYMENT_PENDING":
        return "Hi {{customerName}},\n\nReminder: Your {{businessName}} order #{{orderId}} has an outstanding balance of {{balance}}.\n\nPlease contact us or visit {{businessName}} to complete the payment.\n\nThank you.";
      case "ORDER_CREATED":
        return "Hi {{customerName}},\n\nThank you for choosing {{businessName}}. Your order #{{orderId}} has been placed successfully.\nTotal Amount: {{total}}\nExpected Delivery: {{deliveryDate}}\n\nThank you,\n{{businessName}}";
      case "ORDER_DELIVERED":
        return "Hi {{customerName}},\n\nYour order #{{orderId}} has been delivered successfully. Thank you for using {{businessName}}!";
      default:
        return customText || "Hi {{customerName}},\n\nThank you for choosing {{businessName}}.";
    }
  };

  const currentBody = getTemplateBody(messageType);
  const interpolated = interpolateWhatsAppTemplate(currentBody, {
    customerName,
    // No fabricated "ORD-1024"/"INV-1024" fallback: this dialog is also
    // opened with no order context at all (e.g. the Customer profile's
    // generic "Send WhatsApp" button), and a plausible-looking fake
    // reference number in that preview could get sent to a real customer.
    // Leaving these undefined lets interpolateWhatsAppTemplate's own
    // obviously-a-placeholder "ORD-XXXX"/"INV-XXXX" fallback show instead.
    orderId: orderNumber || orderId || undefined,
    invoiceNumber: orderNumber ? `INV-${orderNumber.replace(/[^0-9]/g, "")}` : undefined,
    total: totalAmount,
    paid: paidAmount,
    balance: outstandingAmount,
    deliveryDate,
    businessName,
    messageText: customText,
  });

  const directWaUrl = `https://wa.me/${formatWhatsAppPhone(phone)}?text=${encodeURIComponent(interpolated)}`;

  const handleSend = () => {
    startTransition(async () => {
      const res = await sendWhatsAppAction({
        phone,
        messageType,
        messageText: interpolated,
        customerId,
        orderId,
        documentName: documentName || (messageType === "INVOICE" ? `Invoice_${orderNumber || "ORD"}.pdf` : undefined),
        documentBase64,
      });

      if (res.ok) {
        toast.success(`WhatsApp message dispatched to ${customerName} (${phone})`);
        onOpenChange(false);
      } else {
        const errorMsg = res.error ? res.error.split(" [FALLBACK_URL:")[0] : "Gateway dispatch unavailable";
        toast.error(errorMsg, {
          description: "Use direct WhatsApp Web / App link to send pre-filled message",
          action: {
            label: "Open WhatsApp",
            onClick: () => window.open(directWaUrl, "_blank"),
          },
          duration: 8000,
        });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-emerald-900/20 bg-card shadow-2xl">
        <DialogHeader className="pb-2 border-b">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-600 text-white font-bold">
              WA
            </div>
            <div>
              <DialogTitle className="text-base font-bold flex items-center gap-2">
                WhatsApp Message
              </DialogTitle>
              <DialogDescription className="text-xs">
                To: <span className="font-semibold text-foreground">{customerName}</span> ({phone})
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Message Type</Label>
            <Select value={messageType} onValueChange={(val) => setMessageType(val as WhatsAppMessageType)}>
              <SelectTrigger className="h-10 border-emerald-500/30">
                <SelectValue placeholder="Select Message Type" />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="mr-2">{opt.icon}</span> {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {messageType === "CUSTOM" && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Custom Note</Label>
              <Textarea
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="Type your custom message text..."
                className="h-20 text-xs"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Message Preview</Label>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/5 dark:bg-emerald-950/30 p-3 text-xs text-foreground whitespace-pre-wrap font-sans leading-relaxed">
              {interpolated}
            </div>
          </div>

          {documentBase64 ? (
            <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/40 p-2.5 text-xs">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <span className="font-semibold text-emerald-950 dark:text-emerald-100">
                    {documentName || `${messageType.replace(/_/g, " ")}.pdf`}
                  </span>
                  <p className="text-[10px] text-muted-foreground">Generated PDF attached</p>
                </div>
              </div>
              <Badge tone="success" className="text-[10px]">Attached</Badge>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
              <ShieldAlert className="size-4 shrink-0" />
              <span>No document attached — this will send as a text-only message.</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-4 border-t">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.open(directWaUrl, "_blank")}
            className="text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 text-xs font-semibold"
          >
            Open Web / App ↗
          </Button>

          <div className="flex items-center gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSend}
              disabled={pending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-2 shadow-md shadow-emerald-950/20"
            >
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Sending...
                </>
              ) : (
                <>
                  <Send className="size-4" /> Send Automated
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

