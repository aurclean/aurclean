import { formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";

/**
 * Normalizes a phone number (however it was entered — with spaces, a leading
 * +, a leading 0, etc.) into the bare digit string OpenWA expects for a JID.
 * The one canonical implementation; see interpolateWhatsAppTemplate above for
 * why this lives in a server-only-free module.
 */
export function formatWhatsAppPhone(phone: string): string {
  if (!phone) return "";
  let digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  // A domestic number is sometimes entered with a leading trunk "0"
  // ("09876543210") rather than the country code — strip it before the
  // 10-digit check below, or it would be sent to WhatsApp as-is (an invalid
  // JID) instead of getting the "91" country code it actually needs.
  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  if (digits.length === 10) return `91${digits}`;
  // A double-prefixed number ("9109876543210" — "91" + "0" + the 10-digit
  // number) collapses to the same "91XXXXXXXXXX" shape.
  if (digits.length === 13 && digits.startsWith("910")) {
    return `91${digits.slice(3)}`;
  }
  return digits;
}

/**
 * Interpolates variables into editable message templates. This is the one
 * canonical implementation — it has no server-only dependencies, so both the
 * server-side send pipeline (src/lib/services/whatsapp.ts) and client
 * components (the composer dialog's live preview) import it from here rather
 * than keeping their own copies in sync by hand.
 */
export function interpolateWhatsAppTemplate(
  templateBody: string,
  variables: {
    customerName?: string;
    orderId?: string;
    invoiceNumber?: string;
    challanNumber?: string;
    total?: number;
    paid?: number;
    balance?: number;
    deliveryDate?: string | Date;
    businessName?: string;
    messageText?: string;
  },
): string {
  return templateBody
    .replace(/\{\{customerName\}\}/g, variables.customerName || "Valued Customer")
    .replace(/\{\{orderId\}\}/g, variables.orderId || "ORD-XXXX")
    .replace(/\{\{invoiceNumber\}\}/g, variables.invoiceNumber || variables.orderId || "INV-XXXX")
    .replace(/\{\{challanNumber\}\}/g, variables.challanNumber || "DC-XXXX")
    .replace(/\{\{total\}\}/g, formatCurrency(variables.total ?? 0))
    .replace(/\{\{paid\}\}/g, formatCurrency(variables.paid ?? 0))
    .replace(/\{\{balance\}\}/g, formatCurrency(variables.balance ?? 0))
    .replace(
      /\{\{deliveryDate\}\}/g,
      variables.deliveryDate ? formatDate(variables.deliveryDate) : "Scheduled Date",
    )
    .replace(/\{\{businessName\}\}/g, variables.businessName || "AURCLEAN")
    .replace(/\{\{messageText\}\}/g, variables.messageText || "");
}
