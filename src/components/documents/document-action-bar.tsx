"use client";

import { useState } from "react";
import { Printer, Download, Send, Eye, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { sendDocumentWhatsAppAction } from "@/app/api/documents/actions";
import { formatWhatsAppPhone } from "@/lib/whatsapp-templates";
import type { DocumentType } from "@/lib/pdf/types";

interface DocumentActionBarProps {
  documentType: DocumentType;
  documentId: string;
  documentNumber: string;
  customerName?: string;
  customerPhone?: string;
  orderNumber?: string;
  pdfUrl?: string;
  showEdit?: boolean;
  editUrl?: string;
}

export function DocumentActionBar({
  documentType,
  documentId,
  documentNumber,
  customerName,
  customerPhone,
}: DocumentActionBarProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sendingWa, setSendingWa] = useState(false);
  const [statusStep, setStatusStep] = useState<string>("");

  const pdfUrl = `/api/documents/pdf?type=${documentType}&id=${documentId}`;
  const downloadUrl = `/api/documents/pdf?type=${documentType}&id=${documentId}&download=true`;

  const handleSendWhatsApp = async () => {
    if (!customerPhone) {
      toast.error("Customer WhatsApp number is missing. Please update the customer profile before sending.");
      return;
    }

    setSendingWa(true);
    setStatusStep("Preparing document & vector PDF...");

    try {
      setStatusStep("Connecting to OpenWA Gateway...");
      const res = await sendDocumentWhatsAppAction({
        documentType,
        documentId,
      });

      if (res.success) {
        setStatusStep("Sent successfully!");
        toast.success(`PDF document ${res.fileName} sent to ${customerPhone} via WhatsApp!`);
      } else {
        setStatusStep("Gateway unavailable");
        const fallbackUrl = `https://wa.me/${formatWhatsAppPhone(customerPhone || "")}?text=${encodeURIComponent(`Hello ${customerName || 'Customer'},\n\nPlease find your ${documentType.replace(/_/g, " ")} #${documentNumber} attached.\n\nThank you.`)}`;

        toast.error("OpenWA Gateway Server Unavailable", {
          description: "Click below to send via WhatsApp Web / App directly",
          action: {
            label: "Open WhatsApp Web ↗",
            onClick: () => window.open(fallbackUrl, "_blank"),
          },
          duration: 10000,
        });
      }
    } catch (err: any) {
      setStatusStep("Sending failed");
      toast.error(err?.message || "WhatsApp sending error");
    } finally {
      setSendingWa(false);
      setTimeout(() => setStatusStep(""), 5000);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card p-4 shadow-sm print:hidden">
      <div className="flex items-center gap-2">
        <FileText className="size-5 text-primary" />
        <div>
          <h4 className="text-sm font-bold text-foreground">{documentNumber}</h4>
          {statusStep && (
            <p className="text-xs font-semibold text-success animate-pulse">{statusStep}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Preview Button */}
        <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)} className="gap-1.5 text-xs">
          <Eye className="size-3.5" /> Preview PDF
        </Button>

        {/* Download PDF Button */}
        <Button asChild variant="outline" size="sm" className="gap-1.5 text-xs">
          <a href={downloadUrl} download>
            <Download className="size-3.5" /> Download PDF
          </a>
        </Button>

        {/* Print Button */}
        <Button asChild variant="outline" size="sm" className="gap-1.5 text-xs">
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
            <Printer className="size-3.5" /> Print
          </a>
        </Button>

        {/* Send WhatsApp Button */}
        <Button
          onClick={handleSendWhatsApp}
          disabled={sendingWa}
          loading={sendingWa}
          variant="success"
          size="sm"
          className="gap-1.5 text-xs"
        >
          <Send className="size-3.5" /> {sendingWa ? "Sending PDF..." : "Send to WhatsApp"}
        </Button>
      </div>

      {/* Real Vector PDF Preview Modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="flex h-[85vh] w-[96vw] max-w-4xl flex-col overflow-hidden rounded-2xl p-0">
          <DialogHeader className="flex flex-row items-center justify-between border-b border-border p-3 sm:p-4">
            <DialogTitle className="flex items-center gap-2 truncate text-sm font-bold text-foreground sm:text-base">
              <FileText className="size-4 shrink-0 text-primary" /> PDF Document Preview: {documentNumber}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 bg-muted p-1 sm:p-2">
            <iframe src={pdfUrl} className="h-full w-full rounded-xl border border-border shadow-inner" title="PDF Document Preview" />
          </div>

          <DialogFooter className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-2 sm:p-3">
            <div className="text-[11px] font-medium text-muted-foreground sm:text-xs">Vector A4 Print-Ready PDF</div>
            <div className="flex flex-wrap gap-1.5 sm:gap-2">
              <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                <a href={downloadUrl} download>
                  <Download className="size-3.5" /> Download
                </a>
              </Button>
              <Button size="sm" className="h-8 text-xs" onClick={() => setPreviewOpen(false)}>
                Close
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
