export type DocumentType =
  | "invoice"
  | "INVOICE"
  | "challan"
  | "delivery_challan"
  | "DELIVERY_CHALLAN"
  | "payment_receipt"
  | "PAYMENT_RECEIPT"
  | "delivery_receipt"
  | "DELIVERY_RECEIPT"
  | "order_summary"
  | "ORDER_SUMMARY"
  | "statement"
  | "STATEMENT"
  | "expense"
  | "expense_receipt"
  | "EXPENSE_RECEIPT";

export interface CompanyProfile {
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  gstin: string;
  logoUrl?: string;
  footerText?: string;
  termsConditions?: string;
  invoicePrefix?: string;
  challanPrefix?: string;
  receiptPrefix?: string;
}
