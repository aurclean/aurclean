import "server-only";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import {
  getWhatsAppStatus,
  formatWhatsAppPhone,
  sendWhatsAppMessage,
} from "./whatsapp";
import {
  generateInvoicePDF,
  generateChallanPDF,
  generatePaymentReceiptPDF,
  generateDeliveryReceiptPDF,
  generateOrderSummaryPDF,
  generateStatementPDF,
  generateExpenseReceiptPDF,
} from "@/lib/pdf/pdf-templates";
import { getCompanyProfile } from "@/lib/pdf/pdf-builder";
import type { WhatsAppMessageType } from "@/generated/prisma/client";

import type { DocumentType } from "@/lib/pdf/types";
export type { DocumentType };

export interface SendDocumentWhatsAppParams {
  firmId: string;
  documentType: DocumentType;
  documentId: string;
  phone?: string; // Optional override; defaults to customer phone
  sentByUserId?: string;
  customCaption?: string;
}

/**
 * Server-side Document WhatsApp Delivery Service.
 * Generates official vector PDF and dispatches directly to customer's WhatsApp over OpenWA.
 */
export async function sendDocumentToWhatsApp(params: SendDocumentWhatsAppParams): Promise<{
  success: boolean;
  messageId: string;
  fileName: string;
  status: string;
}> {
  const { firmId, documentType, documentId, phone, sentByUserId, customCaption } = params;

  // These captions are sent to the FIRM'S OWN customer, so they must carry
  // that firm's name, never another tenant's brand.
  const company = await getCompanyProfile(firmId);
  const businessName = company.name || "our team";

  // Fail fast, before spending time generating a PDF nobody can receive yet.
  // sendWhatsAppMessage() re-checks this immediately before its own send
  // attempt too — session state can change in the seconds it takes to
  // render a large document — but there is no reason to build the PDF at
  // all when the gateway is already known to be down.
  const waStatus = await getWhatsAppStatus(firmId, { forceRefresh: true });
  if (!waStatus.connected || waStatus.status !== "ready") {
    throw new Error(
      `WhatsApp Gateway is disconnected (Current status: ${waStatus.status}). Please check OpenWA in Settings -> WhatsApp.`,
    );
  }

  // 1. Generate real PDF Buffer & File Name based on document type

  let pdfResult: { buffer: Buffer; fileName: string };
  let targetPhone = phone || "";
  let customerId: string | null = null;
  let orderId: string | null = null;
  let messageType: WhatsAppMessageType = "CUSTOM";
  let defaultCaption = "";

  const normType = String(documentType).toLowerCase();

  switch (normType) {
    case "invoice": {
      pdfResult = await generateInvoicePDF(documentId);
      const invoice = await prisma.invoice.findUnique({
        where: { id: documentId },
        include: { order: true, customer: true },
      });
      if (!invoice) throw new Error("Invoice record not found.");
      if (invoice.firmId !== firmId) throw new Error("Invoice record not found.");
      targetPhone = targetPhone || invoice.billToPhone || invoice.customer?.phone || "";
      customerId = invoice.customerId;
      orderId = invoice.orderId;
      messageType = "INVOICE";
      defaultCaption = `Hello ${invoice.billToName || 'Valued Customer'},\n\nThank you for choosing ${businessName}.\nPlease find your Tax Invoice #${invoice.invoiceNumber} attached.\n\nTotal: ₹${Number(invoice.totalAmount)}\nBalance Due: ₹${Number(invoice.amountDue)}\n\nThank you,\n${businessName}`;
      break;
    }

    case "challan":
    case "delivery_challan": {
      pdfResult = await generateChallanPDF(documentId);
      const challan = await prisma.deliveryChallan.findUnique({
        where: { id: documentId },
        include: { order: true, customer: true, items: true },
      });
      if (!challan) throw new Error("Delivery Challan record not found.");
      if (challan.firmId !== firmId) throw new Error("Delivery Challan record not found.");
      targetPhone = targetPhone || challan.customerPhone || challan.customer?.phone || "";
      customerId = challan.customerId;
      orderId = challan.orderId;
      messageType = "DELIVERY_CHALLAN";
      defaultCaption = `Hello ${challan.customerName},\n\nYour ${businessName} Delivery Challan #${challan.challanNumber} for Order #${challan.order.orderNumber} is attached.\n\nTotal Items: ${challan.items?.length || 1}\n\nThank you for choosing ${businessName}.`;
      break;
    }

    case "payment_receipt": {
      pdfResult = await generatePaymentReceiptPDF(documentId);
      const payment = await prisma.payment.findUnique({
        where: { id: documentId },
        include: { order: { include: { customer: true } } },
      });
      if (!payment) throw new Error("Payment record not found.");
      if (payment.firmId !== firmId) throw new Error("Payment record not found.");
      targetPhone = targetPhone || payment.order?.customerPhone || "";
      customerId = payment.order?.customerId || null;
      orderId = payment.orderId;
      messageType = "PAYMENT_RECEIPT";
      defaultCaption = `Hello ${payment.order?.customerName || 'Customer'},\n\nPayment Received successfully!\nReceipt No: #${payment.paymentNumber}\nAmount Paid: ₹${Number(payment.amount)}\nMethod: ${payment.method}\n\nThank you,\n${businessName}`;
      break;
    }

    case "delivery_receipt": {
      pdfResult = await generateDeliveryReceiptPDF(documentId);
      const delivery = await prisma.delivery.findUnique({
        where: { id: documentId },
        include: { order: true },
      });
      if (!delivery) throw new Error("Delivery record not found.");
      if (delivery.firmId !== firmId) throw new Error("Delivery record not found.");
      targetPhone = targetPhone || delivery.contactPhone || "";
      customerId = delivery.order.customerId;
      orderId = delivery.orderId;
      messageType = "DELIVERY_RECEIPT";
      defaultCaption = `Hello ${delivery.contactName},\n\nYour ${businessName} Delivery Receipt #${delivery.deliveryNumber} is attached.\nOrder No: #${delivery.order.orderNumber}\n\nThank you for choosing ${businessName}.`;
      break;
    }

    case "order_summary": {
      pdfResult = await generateOrderSummaryPDF(documentId);
      const order = await prisma.order.findUnique({
        where: { id: documentId },
        include: { customer: true },
      });
      if (!order) throw new Error("Order record not found.");
      if (order.firmId !== firmId) throw new Error("Order record not found.");
      targetPhone = targetPhone || order.customerPhone || "";
      customerId = order.customerId;
      orderId = order.id;
      messageType = "ORDER_CREATED";
      defaultCaption = `Hello ${order.customerName},\n\nOrder Summary for Order #${order.orderNumber} is attached.\nTotal Amount: ₹${Number(order.totalAmount)}\nExpected Delivery: ${new Date(order.expectedDeliveryAt).toLocaleDateString()}\n\nThank you,\n${businessName}`;
      break;
    }

    case "statement": {
      pdfResult = await generateStatementPDF(documentId);
      const customer = await prisma.customer.findUnique({
        where: { id: documentId },
      });
      if (!customer) throw new Error("Customer record not found.");
      if (customer.firmId !== firmId) throw new Error("Customer record not found.");
      targetPhone = targetPhone || customer.phone || "";
      customerId = customer.id;
      messageType = "CUSTOM";
      defaultCaption = `Hello ${customer.name},\n\nPlease find your Statement of Account attached.\nTotal Orders: ${customer.orderCount}\nOutstanding Balance: ₹${Number(customer.outstandingAmount)}\n\nThank you,\n${businessName}`;
      break;
    }

    case "expense": {
      pdfResult = await generateExpenseReceiptPDF(documentId);
      const expense = await prisma.expense.findUnique({ where: { id: documentId } });
      if (!expense) throw new Error("Expense record not found.");
      if (expense.firmId !== firmId) throw new Error("Expense record not found.");
      targetPhone = targetPhone || "";
      messageType = "CUSTOM";
      defaultCaption = `Expense Voucher #${expense.expenseNumber} attached. Amount: ₹${Number(expense.amount)}`;
      break;
    }

    default:
      throw new Error(`Unsupported document type: ${documentType}`);
  }

  // 2. Validate Customer Phone Number
  const formattedPhone = formatWhatsAppPhone(targetPhone);
  if (!formattedPhone) {
    throw new Error(
      "Customer WhatsApp phone number is missing or invalid. Please update the customer profile with a valid phone number before sending.",
    );
  }

  // 3. Dispatch base64 PDF via OpenWA Gateway
  const pdfBase64 = pdfResult.buffer.toString("base64");
  const caption = customCaption || defaultCaption;

  const result = await sendWhatsAppMessage({
    firmId,
    phone: formattedPhone,
    messageType,
    messageText: caption,
    customerId: customerId || undefined,
    orderId: orderId || undefined,
    documentName: pdfResult.fileName,
    documentBase64: pdfBase64,
    documentType,
    documentId,
    sentByUserId,
  });

  if (sentByUserId) {
    await recordAudit({
      userId: sentByUserId,
      action: "WHATSAPP_DOCUMENT_SENT",
      entity: "WhatsAppLog",
      entityId: result.messageId,
      summary: `Dispatched ${pdfResult.fileName} to ${formattedPhone} via OpenWA`,
    });
  }

  return {
    success: true,
    messageId: result.messageId,
    fileName: pdfResult.fileName,
    status: result.status,
  };
}
