import "server-only";

import { prisma } from "@/lib/prisma";
import { formatCurrency, amountInWords, num } from "@/lib/money";
import { format } from "date-fns";
import { formatDate, formatTime } from "@/lib/dates";
import {
  getCompanyProfile,
  PDFDocumentBuilder,
  type BranchProfile,
  type PDFTableColumn,
  type PDFTableRow,
  type SummaryLine,
  type FinancialSummaryParams,
} from "./pdf-builder";

const UNIT_LABEL: Record<string, string> = {
  PER_PIECE: "Pcs",
  PER_KG: "Kg",
  FLAT: "-",
};

const ORDER_TYPE_LABEL: Record<string, string> = {
  WALK_IN: "Walk-in",
  PICKUP: "Pickup",
  DELIVERY: "Delivery",
};

function branchProfile(branch: {
  name: string;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
  email?: string | null;
} | null | undefined): BranchProfile {
  return {
    name: branch?.name || "Head Office",
    addressLine: branch?.addressLine,
    city: branch?.city,
    state: branch?.state,
    pincode: branch?.pincode,
    phone: branch?.phone,
    email: branch?.email,
  };
}

/**
 * Downloaded filenames must never carry another firm's brand name — derive
 * the prefix from this firm's own company profile instead of a hardcoded
 * brand string.
 */
function fileNamePrefix(companyName: string): string {
  const slug = companyName
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "Document";
}

/** Thrown when a document is requested by a caller outside its owning firm. */
export class DocumentAccessError extends Error {
  constructor(message = "Document not found") {
    super(message);
    this.name = "DocumentAccessError";
  }
}

/**
 * The record must belong to the firm the caller is authorised for (taken
 * from the session by the caller — never from a request parameter), and every
 * record it is joined to must belong to that same firm. A mismatch is
 * reported as "not found" so another firm's ids are never confirmed.
 */
function assertFirmScope(
  label: string,
  recordFirmId: string,
  expectedFirmId: string | undefined,
  related: Array<{ firmId?: string | null } | null | undefined> = [],
) {
  if (expectedFirmId !== undefined && recordFirmId !== expectedFirmId) {
    throw new DocumentAccessError(`${label} not found.`);
  }
  for (const rel of related) {
    if (rel && rel.firmId && rel.firmId !== recordFirmId) {
      throw new DocumentAccessError(`${label} is inconsistent with its related records.`);
    }
  }
}

export interface GenerateOptions {
  /** The caller's own firm (from the authenticated session). */
  firmId?: string;
}

/** Reference formats: 21-10-2026 and 01:49 PM. */
const pdfDate = (value: Date | string | null | undefined) => (value ? format(new Date(value), "dd-MM-yyyy") : "");
const pdfTime = (value: Date | string | null | undefined) => (value ? format(new Date(value), "hh:mm a") : "");

/**
 * 1. Invoice PDF — a "Tax Invoice" when the firm is GST-registered and tax is
 * charged on this invoice, otherwise a "Bill of Supply". All figures are the
 * saved invoice's own; nothing is recomputed here.
 */
export async function generateInvoicePDF(
  invoiceId: string,
  opts: GenerateOptions = {},
): Promise<{ buffer: Buffer; fileName: string }> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      order: {
        include: {
          items: { include: { garmentType: true, service: true } },
        },
      },
      customer: true,
      lines: true,
      branch: true,
      payments: { orderBy: { paidAt: "desc" }, take: 1 },
    },
  });

  if (!invoice) throw new DocumentAccessError("Invoice not found.");
  assertFirmScope("Invoice", invoice.firmId, opts.firmId, [invoice.branch, invoice.order, invoice.customer]);

  const company = await getCompanyProfile(invoice.firmId);
  const gstAmount = num(invoice.cgstAmount) + num(invoice.sgstAmount) + num(invoice.igstAmount);
  const isTaxInvoice = gstAmount > 0 && Boolean(company.gstin);
  const docTitle = isTaxInvoice ? "Tax Invoice" : "Bill of Supply";

  const builder = await PDFDocumentBuilder.create(company, `${docTitle} ${invoice.invoiceNumber}`);

  builder.renderCompanyHeader(branchProfile(invoice.branch));
  builder.renderDocumentTitle(docTitle);

  const orderType = invoice.order ? ORDER_TYPE_LABEL[invoice.order.type] || invoice.order.type : "";

  const billTo = [
    invoice.billToName || invoice.customer?.name || "Valued Customer",
    `Contact No.: ${invoice.billToPhone || invoice.customer?.phone || ""}`,
  ];
  if (invoice.billToAddress) billTo.push(invoice.billToAddress);
  if (invoice.billToGstin) billTo.push(`GSTIN: ${invoice.billToGstin}`);

  builder.renderInfoColumns([
    { heading: "Bill To", lines: billTo },
    {
      heading: "Transportation Details",
      lines: [
        `Branch: ${invoice.branch.name}`,
        `Pickup/Delivery: ${orderType}`,
        `Delivery Date: ${invoice.order?.expectedDeliveryAt ? pdfDate(invoice.order.expectedDeliveryAt) : ""}`,
      ],
    },
    {
      heading: "Invoice Details",
      lines: [`Invoice No. ${invoice.invoiceNumber}`, `Date: ${pdfDate(invoice.issuedAt)}`, `Time: ${pdfTime(invoice.issuedAt)}`],
    },
  ]);

  const columns: PDFTableColumn[] = [
    { id: "sl", header: "#", width: 7, align: "left" },
    { id: "item", header: "Item name", width: 35 },
    { id: "qty", header: "Quantity", width: 13, align: "right" },
    { id: "unit", header: "Unit", width: 9, align: "right" },
    { id: "rate", header: "Final Rate", width: 17, align: "right" },
    { id: "amount", header: "Amount", width: 19, align: "right" },
  ];

  // Each OrderItem already carries its saved quantity, pricing mode and line
  // total — those exact values are printed.
  const orderItems = invoice.order?.items ?? [];
  let totalQty = 0;

  const rows: PDFTableRow[] =
    orderItems.length > 0
      ? orderItems.map((item, idx) => {
          totalQty += item.quantity;
          return {
            sl: idx + 1,
            item: `${item.garmentType.name} ${item.service.name}`,
            qty: item.quantity,
            unit: UNIT_LABEL[item.pricingMode] || "-",
            rate: formatCurrency(item.unitPrice),
            amount: formatCurrency(item.lineTotal),
          };
        })
      : invoice.lines.map((line, idx) => {
          totalQty += num(line.quantity);
          return {
            sl: idx + 1,
            item: line.description,
            qty: num(line.quantity),
            unit: "-",
            rate: formatCurrency(line.unitPrice),
            amount: formatCurrency(line.lineTotal),
          };
        });

  const paymentMode = invoice.payments[0]?.method || "Credit";
  const currentBalance = invoice.customer ? num(invoice.customer.outstandingAmount) : num(invoice.amountDue);
  const previousBalance = Math.max(0, currentBalance - num(invoice.amountDue));

  const summaryLines: SummaryLine[] = [{ label: "Sub Total", value: formatCurrency(invoice.subtotal) }];
  if (num(invoice.discountAmount) > 0) {
    summaryLines.push({ label: "Discount", value: `-${formatCurrency(invoice.discountAmount)}` });
  }
  if (gstAmount > 0) {
    const half = num(invoice.gstRate) / 2;
    if (num(invoice.cgstAmount) > 0) summaryLines.push({ label: `CGST (${half}%)`, value: formatCurrency(invoice.cgstAmount) });
    if (num(invoice.sgstAmount) > 0) summaryLines.push({ label: `SGST (${half}%)`, value: formatCurrency(invoice.sgstAmount) });
    if (num(invoice.igstAmount) > 0) summaryLines.push({ label: `IGST (${num(invoice.gstRate)}%)`, value: formatCurrency(invoice.igstAmount) });
  }
  summaryLines.push(
    { label: "Total", value: formatCurrency(invoice.totalAmount), highlight: true },
    { label: "Received", value: formatCurrency(invoice.amountPaid) },
    { label: "Balance", value: formatCurrency(invoice.amountDue), bold: true },
    { label: "Payment mode", value: paymentMode },
    { label: "Previous Balance", value: formatCurrency(previousBalance) },
    { label: "Current Balance", value: formatCurrency(currentBalance) },
  );

  const summary: FinancialSummaryParams = {
    amountWordsLabel: "Invoice Amount In Words",
    amountWords: amountInWords(invoice.totalAmount),
    terms: company.termsConditions,
    lines: summaryLines,
    signatory: { forName: `${company.name} - ${invoice.branch.name}` },
  };

  // The last item rows travel with the totals block, so a summary is never
  // stranded alone on a continuation page.
  builder.renderItemsTable(
    columns,
    rows,
    { sl: "", item: "Total", qty: totalQty, unit: "", rate: "", amount: formatCurrency(invoice.subtotal) },
    builder.measureFinancialSummary(summary),
  );
  builder.renderFinancialSummary(summary);

  const buffer = await builder.build();
  return {
    buffer,
    fileName: `${fileNamePrefix(company.name)}-${isTaxInvoice ? "Invoice" : "Bill"}-${invoice.invoiceNumber}.pdf`,
  };
}

/**
 * 2. Delivery Challan PDF — a non-financial document: garments in transit
 * only. No rate, subtotal, discount, tax, total, payment or balance is ever
 * read into this template.
 */
export async function generateChallanPDF(
  challanId: string,
  opts: GenerateOptions = {},
): Promise<{ buffer: Buffer; fileName: string }> {
  const challan = await prisma.deliveryChallan.findUnique({
    where: { id: challanId },
    include: {
      order: true,
      customer: true,
      items: { orderBy: { createdAt: "asc" } },
      branch: true,
    },
  });

  if (!challan) throw new DocumentAccessError("Delivery Challan not found.");
  assertFirmScope("Delivery Challan", challan.firmId, opts.firmId, [challan.branch, challan.order, challan.customer]);

  const company = await getCompanyProfile(challan.firmId);
  const builder = await PDFDocumentBuilder.create(company, `Delivery Challan ${challan.challanNumber}`, "a5-on-a4");

  builder.renderCompanyHeader(branchProfile(challan.branch));
  builder.renderDocumentTitle("Delivery Challan");

  const orderType = ORDER_TYPE_LABEL[challan.order.type] || challan.order.type;
  const deliveryDate = challan.deliveryDate || challan.expectedDeliveryDate;
  const address = challan.customerAddress || challan.order.addressLine;

  const customerLines = [challan.customerName, `Contact No.: ${challan.customerPhone}`];
  if (address) customerLines.push(`Address: ${address}`);

  builder.renderInfoColumns([
    { heading: "Delivery Challan for", lines: customerLines },
    {
      heading: "Transportation Details",
      lines: [
        `Branch: ${challan.branch.name}`,
        `Pickup/Delivery: ${orderType}`,
        `Delivery Date: ${deliveryDate ? pdfDate(deliveryDate) : ""}`,
      ],
    },
    {
      heading: "Challan Details",
      lines: [`Challan No. ${challan.challanNumber}`, `Date: ${pdfDate(challan.challanDate)}`, `Time: ${pdfTime(challan.challanDate)}`],
    },
  ]);

  const columns: PDFTableColumn[] = [
    { id: "sl", header: "#", width: 8, align: "left" },
    { id: "item", header: "Item name", width: 62 },
    { id: "qty", header: "Quantity", width: 16, align: "right" },
    { id: "unit", header: "Unit", width: 14, align: "right" },
  ];

  // One row per distinct item (garment + service), quantities summed — the
  // challan stores one record per garment, the printed document lists "Kids
  // Shirt Steam Press — 4 Pcs".
  const grouped = new Map<string, { name: string; qty: number }>();
  for (const item of challan.items) {
    const name = [item.description || item.category, item.service].filter(Boolean).join(" ");
    const entry = grouped.get(name);
    if (entry) entry.qty += item.quantity;
    else grouped.set(name, { name, qty: item.quantity });
  }

  let totalQty = 0;
  const rows: PDFTableRow[] = [...grouped.values()].map((g, idx) => {
    totalQty += g.qty;
    return { sl: idx + 1, item: g.name, qty: g.qty, unit: "Pcs" };
  });

  const footer = {
    terms: challan.terms || company.termsConditions,
    forName: `${company.name} - ${challan.branch.name}`,
    title: "Authorized Signatory",
  };

  // The last item rows travel with the terms/signature block.
  builder.renderItemsTable(
    columns,
    rows,
    { sl: "", item: "Total", qty: totalQty, unit: "" },
    builder.measureTermsAndSignature(footer),
  );
  builder.renderTermsAndSignature(footer);

  const buffer = await builder.build();
  return {
    buffer,
    fileName: `${fileNamePrefix(company.name)}-Delivery-Challan-${challan.challanNumber}.pdf`,
  };
}

/**
 * 3. Payment Receipt PDF Generator
 */
export async function generatePaymentReceiptPDF(paymentId: string, opts: GenerateOptions = {}): Promise<{ buffer: Buffer; fileName: string }> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      order: { include: { customer: true } },
      invoice: true,
      branch: true,
      receivedBy: true,
    },
  });

  if (!payment) throw new DocumentAccessError("Payment not found.");
  assertFirmScope("Payment", payment.firmId, opts.firmId, [payment.branch, payment.order, payment.invoice]);

  const company = await getCompanyProfile(payment.firmId);
  const builder = await PDFDocumentBuilder.create(company, "Payment Receipt");

  builder.renderCompanyHeader(branchProfile(payment.branch));
  builder.renderDocumentTitle("Payment Receipt");

  builder.renderInfoColumns([
    {
      heading: "Received From",
      lines: [
        payment.order?.customerName || "Valued Customer",
        `Contact No.: ${payment.order?.customerPhone || "—"}`,
      ],
    },
    {
      heading: "Receipt Details",
      lines: [
        `Receipt No.: ${payment.paymentNumber}`,
        `Order No.: ${payment.order?.orderNumber || "—"}`,
        `Invoice No.: ${payment.invoice?.invoiceNumber || "—"}`,
        `Date: ${formatDate(payment.paidAt)}`,
        `Time: ${formatTime(payment.paidAt)}`,
      ],
    },
  ]);

  // Previous balance is a real derivation, not a stored/fabricated figure:
  // the order's current outstanding amount already reflects this payment,
  // so adding the payment back gives what was owed immediately before it.
  const remainingBalance = payment.order ? Math.max(0, num(payment.order.outstandingAmount)) : 0;
  const previousBalance = remainingBalance + num(payment.amount);

  const summaryLines: SummaryLine[] = [
    { label: "Amount Received", value: formatCurrency(payment.amount), highlight: true },
    { label: "Payment Method", value: payment.method },
  ];
  if (payment.reference || payment.providerPaymentId) {
    summaryLines.push({ label: "Transaction Reference", value: payment.reference || payment.providerPaymentId || "—" });
  }
  summaryLines.push(
    { label: "Previous Balance", value: formatCurrency(previousBalance) },
    { label: "Remaining Balance", value: formatCurrency(remainingBalance), bold: true },
  );

  builder.renderFinancialSummary({
    amountWordsLabel: "Amount In Words",
    amountWords: amountInWords(payment.amount),
    terms: `This is an official payment receipt issued by ${company.name}.`,
    lines: summaryLines,
  });

  builder.renderSignatureBlock([
    { title: "Authorized Signatory", name: payment.receivedBy?.name || `${company.name} - ${payment.branch.name}` },
  ]);

  const buffer = await builder.build();
  return {
    buffer,
    fileName: `${fileNamePrefix(company.name)}-Payment-Receipt-${payment.paymentNumber}.pdf`,
  };
}

/**
 * 4. Delivery Receipt PDF Generator — non-financial acknowledgement of
 * garments handed over to the customer.
 */
export async function generateDeliveryReceiptPDF(deliveryId: string, opts: GenerateOptions = {}): Promise<{ buffer: Buffer; fileName: string }> {
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: {
      order: { include: { garments: { include: { garmentType: true } } } },
      driver: { include: { user: true } },
      branch: true,
    },
  });

  if (!delivery) throw new DocumentAccessError("Delivery not found.");
  assertFirmScope("Delivery", delivery.firmId, opts.firmId, [delivery.branch, delivery.order]);

  const company = await getCompanyProfile(delivery.firmId);
  const builder = await PDFDocumentBuilder.create(company, "Delivery Receipt");

  builder.renderCompanyHeader(branchProfile(delivery.branch));
  builder.renderDocumentTitle("Delivery Receipt");

  const deliveredAt = delivery.deliveredAt || delivery.scheduledAt;

  builder.renderInfoColumns([
    {
      heading: "Delivered To",
      lines: [delivery.contactName, `Contact No.: ${delivery.contactPhone}`],
    },
    {
      heading: "Delivery Details",
      lines: [
        `Delivery Receipt No.: ${delivery.deliveryNumber}`,
        `Order No.: ${delivery.order.orderNumber}`,
        `Delivery Date: ${formatDate(deliveredAt)}`,
        `Delivery Time: ${formatTime(deliveredAt)}`,
      ],
    },
  ]);

  const columns: PDFTableColumn[] = [
    { id: "sl", header: "#", width: 6, align: "center" },
    { id: "item", header: "Item", width: 58 },
    { id: "qty", header: "Quantity", width: 18, align: "center" },
    { id: "unit", header: "Unit", width: 18, align: "center" },
  ];

  const rows: PDFTableRow[] = (delivery.order.garments || []).map((g, idx) => ({
    sl: idx + 1,
    item: g.garmentType.name,
    qty: 1,
    unit: "Pcs",
  }));

  builder.renderItemsTable(columns, rows, {
    sl: "",
    item: "TOTAL",
    qty: rows.length,
    unit: "",
  });

  builder.renderNotesBlock("Customer confirms receipt of garments in good condition.");

  builder.renderSignatureBlock(
    [
      { title: "Received By", name: delivery.receivedByName || delivery.contactName },
      { title: "Delivered By", name: delivery.driver?.user.name || "Courier" },
      { title: "Customer Acknowledgement" },
      { title: "Authorized Signatory", name: `${company.name} - ${delivery.branch.name}` },
    ],
    "spread",
  );

  const buffer = await builder.build();
  return {
    buffer,
    fileName: `${fileNamePrefix(company.name)}-Delivery-Receipt-${delivery.deliveryNumber}.pdf`,
  };
}

/**
 * 5. Order Summary PDF Generator
 */
export async function generateOrderSummaryPDF(orderId: string, opts: GenerateOptions = {}): Promise<{ buffer: Buffer; fileName: string }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: true,
      items: { include: { service: true, garmentType: true } },
      branch: true,
    },
  });

  if (!order) throw new DocumentAccessError("Order not found.");
  assertFirmScope("Order", order.firmId, opts.firmId, [order.branch]);

  const company = await getCompanyProfile(order.firmId);
  const builder = await PDFDocumentBuilder.create(company, "Order Summary");

  builder.renderCompanyHeader(branchProfile(order.branch));
  builder.renderDocumentTitle("Order Summary");

  builder.renderInfoColumns([
    {
      heading: "Customer",
      lines: [order.customerName, `Contact No.: ${order.customerPhone}`],
    },
    {
      heading: "Transportation Details",
      lines: [
        `Branch: ${order.branch.name}`,
        `Pickup/Delivery: ${ORDER_TYPE_LABEL[order.type] || order.type}`,
        `Delivery Date: ${formatDate(order.expectedDeliveryAt)}`,
      ],
    },
    {
      heading: "Order Details",
      lines: [`Order No.: ${order.orderNumber}`, `Date: ${formatDate(order.placedAt)}`, `Time: ${formatTime(order.placedAt)}`],
    },
  ]);

  const columns: PDFTableColumn[] = [
    { id: "sl", header: "#", width: 5, align: "center" },
    { id: "item", header: "Item Name", width: 33 },
    { id: "qty", header: "Quantity", width: 13, align: "center" },
    { id: "unit", header: "Unit", width: 9, align: "center" },
    { id: "rate", header: "Final Rate", width: 18, align: "right" },
    { id: "amount", header: "Amount", width: 22, align: "right" },
  ];

  let totalQty = 0;
  const rows: PDFTableRow[] = order.items.map((item, idx) => {
    totalQty += item.quantity;
    return {
      sl: idx + 1,
      item: `${item.garmentType.name} - ${item.service.name}`,
      qty: item.quantity,
      unit: UNIT_LABEL[item.pricingMode] || "-",
      rate: formatCurrency(item.unitPrice),
      amount: formatCurrency(item.lineTotal),
    };
  });

  builder.renderItemsTable(columns, rows, {
    sl: "",
    item: "TOTAL",
    qty: totalQty,
    unit: "",
    rate: "",
    amount: formatCurrency(order.subtotal),
  });

  const summaryLines: SummaryLine[] = [{ label: "Sub Total", value: formatCurrency(order.subtotal) }];
  if (num(order.discountAmount) > 0) {
    summaryLines.push({ label: "Discount", value: `-${formatCurrency(order.discountAmount)}` });
  }
  if (num(order.gstAmount) > 0) {
    summaryLines.push({ label: `GST (${num(order.gstRate)}%)`, value: formatCurrency(order.gstAmount) });
  }
  summaryLines.push(
    { label: "TOTAL", value: formatCurrency(order.totalAmount), highlight: true },
    { label: "Paid", value: formatCurrency(order.paidAmount) },
    { label: "Balance", value: formatCurrency(order.outstandingAmount), bold: true },
  );

  builder.renderFinancialSummary({
    amountWordsLabel: "Amount In Words",
    amountWords: amountInWords(order.totalAmount),
    terms: order.specialInstructions || company.termsConditions,
    lines: summaryLines,
  });

  builder.renderSignatureBlock([{ title: "Authorized Signatory", name: `${company.name} - ${order.branch.name}` }]);

  const buffer = await builder.build();
  return {
    buffer,
    fileName: `${fileNamePrefix(company.name)}-Order-Summary-${order.orderNumber}.pdf`,
  };
}

/**
 * 6. Customer Statement / Ledger PDF Generator
 */
export async function generateStatementPDF(customerId: string, opts: GenerateOptions = {}): Promise<{ buffer: Buffer; fileName: string }> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      orders: { orderBy: { placedAt: "desc" }, take: 50 },
      branch: true,
    },
  });

  if (!customer) throw new DocumentAccessError("Customer not found.");
  assertFirmScope("Customer", customer.firmId, opts.firmId, [customer.branch]);

  const company = await getCompanyProfile(customer.firmId);
  const builder = await PDFDocumentBuilder.create(company, "Statement");

  const statementNo = `STM-${customer.code}-${Date.now().toString().slice(-4)}`;
  builder.renderCompanyHeader(branchProfile(customer.branch));
  builder.renderDocumentTitle("Customer Statement");

  builder.renderInfoColumns([
    {
      heading: "Statement For",
      lines: [customer.name, `Contact No.: ${customer.phone}`],
    },
    {
      heading: "Account Summary",
      lines: [`Total Orders: ${customer.orderCount}`, `Lifetime Spend: ${formatCurrency(customer.totalSpent)}`],
    },
    {
      heading: "Statement Details",
      lines: [`Statement No.: ${statementNo}`, `Date: ${formatDate(new Date())}`, `Time: ${formatTime(new Date())}`],
    },
  ]);

  const columns: PDFTableColumn[] = [
    { id: "sl", header: "#", width: 6, align: "center" },
    { id: "item", header: "Order No", width: 24 },
    { id: "date", header: "Date", width: 18 },
    { id: "status", header: "Status", width: 18, align: "center" },
    { id: "total", header: "Total", width: 17, align: "right" },
    { id: "balance", header: "Balance", width: 17, align: "right" },
  ];

  const rows: PDFTableRow[] = customer.orders.map((ord, idx) => ({
    sl: idx + 1,
    item: ord.orderNumber,
    date: formatDate(ord.placedAt),
    status: ord.status.replace(/_/g, " "),
    total: formatCurrency(ord.totalAmount),
    balance: formatCurrency(ord.outstandingAmount),
  }));

  builder.renderItemsTable(columns, rows);

  builder.renderFinancialSummary({
    amountWordsLabel: "Outstanding Amount In Words",
    amountWords: amountInWords(customer.outstandingAmount),
    terms: `Statement of Account generated from ${company.name}.`,
    lines: [
      { label: "Lifetime Spend", value: formatCurrency(customer.totalSpent) },
      { label: "Outstanding Balance", value: formatCurrency(customer.outstandingAmount), highlight: true },
    ],
  });

  builder.renderSignatureBlock([{ title: "Authorized Signatory", name: `${company.name} - ${customer.branch.name}` }]);

  const buffer = await builder.build();
  return {
    buffer,
    fileName: `${fileNamePrefix(company.name)}-Statement-${customer.code}.pdf`,
  };
}

/**
 * 7. Expense Voucher PDF Generator
 */
export async function generateExpenseReceiptPDF(expenseId: string, opts: GenerateOptions = {}): Promise<{ buffer: Buffer; fileName: string }> {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: { branch: true, createdBy: true, approvedBy: true },
  });

  if (!expense) throw new DocumentAccessError("Expense not found.");
  assertFirmScope("Expense", expense.firmId, opts.firmId, [expense.branch]);

  const company = await getCompanyProfile(expense.firmId);
  const builder = await PDFDocumentBuilder.create(company, "Expense Voucher");

  builder.renderCompanyHeader(branchProfile(expense.branch));
  builder.renderDocumentTitle("Expense Voucher");

  builder.renderInfoColumns([
    {
      heading: "Payee",
      lines: [expense.paidTo || "Operational Expense", `Category: ${expense.category}`],
    },
    {
      heading: "Voucher Details",
      lines: [
        `Expense No.: ${expense.expenseNumber}`,
        `Date: ${formatDate(expense.expenseDate)}`,
        `Payment Method: ${expense.paymentMethod}`,
      ],
    },
  ]);

  const columns: PDFTableColumn[] = [
    { id: "sl", header: "#", width: 8, align: "center" },
    { id: "item", header: "Description", width: 52 },
    { id: "category", header: "Category", width: 20, align: "center" },
    { id: "amount", header: "Amount", width: 20, align: "right" },
  ];

  const rows: PDFTableRow[] = [
    {
      sl: 1,
      item: expense.description,
      category: expense.category,
      amount: formatCurrency(expense.amount),
    },
  ];

  builder.renderItemsTable(columns, rows, {
    sl: "",
    item: "TOTAL",
    category: "",
    amount: formatCurrency(expense.amount),
  });

  builder.renderFinancialSummary({
    amountWordsLabel: "Amount In Words",
    amountWords: amountInWords(expense.amount),
    lines: [{ label: "Amount", value: formatCurrency(expense.amount), highlight: true }],
  });

  builder.renderSignatureBlock(
    [
      { title: "Prepared By", name: expense.createdBy?.name || company.name },
      { title: "Approved By", name: expense.approvedBy?.name || "Manager" },
    ],
    "spread",
  );

  const buffer = await builder.build();
  return {
    buffer,
    fileName: `${fileNamePrefix(company.name)}-Expense-${expense.expenseNumber}.pdf`,
  };
}
