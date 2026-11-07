"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { WhatsAppComposerDialog } from "./whatsapp-composer-dialog";
import type { WhatsAppMessageType } from "@/generated/prisma/client";

export interface WhatsAppButtonProps {
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
  label?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "icon" | "icon-sm";
  className?: string;
  businessName: string;
}

export function WhatsAppButton({
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
  label = "WhatsApp",
  variant = "outline",
  size = "sm",
  className = "",
  businessName,
}: WhatsAppButtonProps) {
  const [composerOpen, setComposerOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => setComposerOpen(true)}
        className={`gap-1.5 border-emerald-600/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:text-emerald-800 ${className}`}
        title={`Send WhatsApp message to ${customerName}`}
      >
        <MessageSquare className="size-3.5 fill-emerald-600/20 text-emerald-600 dark:text-emerald-400" />
        {label && <span>{label}</span>}
      </Button>

      {composerOpen && (
        <WhatsAppComposerDialog
          open={composerOpen}
          onOpenChange={setComposerOpen}
          customerName={customerName}
          phone={phone}
          customerId={customerId}
          orderId={orderId}
          orderNumber={orderNumber}
          totalAmount={totalAmount}
          paidAmount={paidAmount}
          outstandingAmount={outstandingAmount}
          deliveryDate={deliveryDate}
          initialType={initialType}
          documentName={documentName}
          documentBase64={documentBase64}
          businessName={businessName}
        />
      )}
    </>
  );
}
