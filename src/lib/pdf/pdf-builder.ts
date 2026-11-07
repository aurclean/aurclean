import "server-only";

import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { prisma } from "@/lib/prisma";
import { formatCurrency, amountInWords as amountInWordsHelper } from "@/lib/money";
import { formatDate, formatTime } from "@/lib/dates";

// Traditional, print-safe business-document palette — pure white page, black
// body text, AURCLEAN forest green for the accents (table headers, the
// document title, the separator rule, and the highlighted total row). No
// grays, cards, or shadows: this is meant to look like a printed accounting
// document, not a web dashboard panel.
export const COLORS = {
  primary: "#0a3b2c", // AURCLEAN forest green — matches the app's own --brand token
  primaryDark: "#062418",
  ink: "#000000",
  muted: "#3f3f3f",
  border: "#9aa39c",
  white: "#ffffff",
};

// PDFKit's 14 built-in base fonts (Helvetica, etc.) use WinAnsiEncoding,
// which has no glyph for the Rupee sign (U+20B9, standardized in 2010) —
// every ₹ in a document rendered with them prints as a broken superscript
// "¹". DejaVu Sans does have the glyph and is bundled below so this holds
// regardless of what fonts happen to be installed on the host OS.
const FONT_REGULAR = "DejaVuSans";
const FONT_BOLD = "DejaVuSans-Bold";

import type { CompanyProfile } from "./types";
export type { CompanyProfile };

export interface BranchProfile {
  name: string;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
  email?: string | null;
}

/**
 * Every PDF must reflect only the firm it was generated for — never
 * whichever firm's settings happened to be read first. Callers always pass
 * the firmId straight from the record the document is for (invoice.firmId,
 * challan.firmId, ...), never from the viewing user's session, so a
 * PLATFORM_ADMIN previewing across firms can never leak one firm's branding
 * onto another firm's document.
 */
export async function getCompanyProfile(firmId: string): Promise<CompanyProfile> {
  const [settings, firm] = await Promise.all([
    prisma.setting.findMany({
      where: {
        firmId,
        category: { in: ["company", "documents", "general"] },
      },
    }),
    // Falls back to the firm's own registration details — never to another
    // firm's brand name — when this firm hasn't configured its document
    // settings yet (e.g. a just-created firm that hasn't visited
    // Settings > Documents).
    prisma.firm.findUnique({
      where: { id: firmId },
      select: { name: true, addressLine: true, city: true, state: true, pincode: true, phone: true, email: true, website: true, gstin: true, logoUrl: true },
    }),
  ]);

  const map = new Map(settings.map((s) => [s.key, s.value]));
  const firmAddress = firm
    ? [firm.addressLine, firm.city, firm.state, firm.pincode].filter(Boolean).join(", ")
    : "";

  return {
    name: map.get("company_name") || map.get("app_name") || firm?.name || "",
    // No fabricated address/phone/GSTIN here: an unconfigured field is left
    // blank (and the footer omits it) rather than printing a placeholder
    // that reads as a real registered business number on every document.
    address: map.get("company_address") || firmAddress || "",
    phone: map.get("company_phone") || firm?.phone || "",
    email: map.get("company_email") || firm?.email || "",
    website: map.get("company_website") || firm?.website || "",
    gstin: map.get("company_gstin") || firm?.gstin || "",
    logoUrl: map.get("company_logo") || firm?.logoUrl || "/logo.png",
    footerText: map.get("document_footer_text") || "Thank you for choosing us. Dedicated to laundry excellence.",
    termsConditions:
      map.get("document_terms") ||
      "1. No guarantee against colour loss, bleeding & shrinkage.\n2. In case of rare damage, the company's liability shall be limited to a maximum of eight (8) times the processing (laundry/dry clean) cost.",
    invoicePrefix: map.get("invoice_prefix") || "INV",
    challanPrefix: map.get("challan_prefix") || "DC",
    receiptPrefix: map.get("receipt_prefix") || "REC",
  };
}

export interface PDFTableColumn {
  id: string;
  header: string;
  width: number; // percentage of content width
  align?: "left" | "center" | "right";
}

export interface PDFTableRow {
  [key: string]: string | number;
}

export interface InfoColumn {
  heading: string;
  lines: string[];
}

export interface SummaryLine {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean; // green background, white text — the document's headline figure
}

/**
 * Shared PDFKit document-assembly system for every AURCLEAN business
 * document (Bill of Supply, Delivery Challan, Payment Receipt, Delivery
 * Receipt). One component per visual block (header, title, info columns,
 * items table, financial summary, signature) so the four templates configure
 * the same building blocks instead of four unrelated implementations.
 */
export class PDFDocumentBuilder {
  doc: InstanceType<typeof PDFDocument>;
  company: CompanyProfile;
  pageWidth = 595.28; // A4 pt (210mm)
  pageHeight = 841.89; // A4 pt (297mm)
  margin = 32;
  contentWidth: number;
  currentY: number;

  /**
   * The lowest y body content may reach before a new page is started. Kept
   * a few points above the document's own bottom margin (pageHeight -
   * margin) on purpose: that exact boundary is also where PDFKit's own
   * internal overflow check lives, and it triggers on the real rendered
   * height of a text call, not on this class's own (necessarily
   * approximate) heightOfString estimates. Landing a block flush against
   * that line — where a sub-point rounding difference between the two is
   * enough to tip it over — is what silently added a blank trailing page
   * with only a footer on it here before; the margin below keeps every
   * block's real footprint clear of that boundary.
   */
  readonly maxY: number;
  private static readonly BOTTOM_SAFETY = 20;

  /** Re-invoked on every page after the first, to repeat the table header. */
  private onNewPage: (() => void) | null = null;

  constructor(company: CompanyProfile) {
    this.company = company;
    this.contentWidth = this.pageWidth - this.margin * 2;
    this.maxY = this.pageHeight - this.margin - PDFDocumentBuilder.BOTTOM_SAFETY;
    this.doc = new PDFDocument({
      size: "A4",
      margin: this.margin,
      bufferPages: true,
      info: {
        Title: "AURCLEAN Document",
        Author: company.name,
        Creator: "AURCLEAN ERP Document System",
      },
    });
    this.currentY = this.margin;

    this.doc.registerFont(FONT_REGULAR, path.join(process.cwd(), "public", "fonts", "DejaVuSans.ttf"));
    this.doc.registerFont(FONT_BOLD, path.join(process.cwd(), "public", "fonts", "DejaVuSans-Bold.ttf"));
    this.doc.font(FONT_REGULAR);
  }

  private text(
    value: string,
    x: number,
    y: number,
    opts: PDFKit.Mixins.TextOptions & { bold?: boolean; size?: number; color?: string } = {},
  ) {
    const { bold, size, color, ...rest } = opts;
    this.doc
      .font(bold ? FONT_BOLD : FONT_REGULAR)
      .fontSize(size ?? 9)
      .fillColor(color ?? COLORS.ink)
      .text(value, x, y, rest);
  }

  private hr(y: number, color: string = COLORS.border, width = 0.75) {
    this.doc
      .moveTo(this.margin, y)
      .lineTo(this.pageWidth - this.margin, y)
      .strokeColor(color)
      .lineWidth(width)
      .stroke();
  }

  /**
   * Starts a new page if `height` of content would cross maxY. Returns
   * whether a page break happened, since callers with their own running `y`
   * (rather than `this.currentY`) need to reset it themselves.
   */
  private ensureSpace(height: number, y?: number): boolean {
    const at = y ?? this.currentY;
    if (at + height <= this.maxY) return false;
    this.doc.addPage();
    this.currentY = this.margin;
    if (this.onNewPage) this.onNewPage();
    return true;
  }

  /**
   * Company details top-left, logo top-right (aspect ratio always
   * preserved — PDFKit's `fit` option scales without stretching), a
   * centered document title, then a thin green rule.
   */
  renderCompanyHeader(branch: BranchProfile) {
    const startY = this.currentY;
    const rightColWidth = 90;
    const leftColWidth = this.contentWidth - rightColWidth - 12;

    this.text(`${this.company.name} - ${branch.name}`, this.margin, startY, {
      bold: true,
      size: 12.5,
      width: leftColWidth,
    });

    let y = startY + 16;
    const addressParts = [branch.addressLine, branch.city, branch.state, branch.pincode].filter(Boolean);
    if (addressParts.length > 0) {
      this.text(addressParts.join(", "), this.margin, y, { size: 8.5, color: COLORS.muted, width: leftColWidth });
      y += 12;
    }

    const phone = branch.phone || this.company.phone;
    if (phone) {
      this.text(`Phone no.: ${phone}`, this.margin, y, { size: 8.5, color: COLORS.muted, width: leftColWidth });
      y += 12;
    }

    const email = branch.email || this.company.email;
    if (email) {
      this.text(`Email: ${email}`, this.margin, y, { size: 8.5, color: COLORS.muted, width: leftColWidth });
      y += 12;
    }

    // Logo, top-right, aspect-ratio preserved and never stretched.
    const logoBox = { w: rightColWidth, h: 52 };
    const logoX = this.pageWidth - this.margin - logoBox.w;
    // A print-resolution copy (300x300 — ~400dpi at this box's printed
    // size), not the source public/logo.png (1254x1254): PDFKit embeds
    // images verbatim with no downscaling, so using the full source made
    // every generated document balloon to over a megabyte for no visible
    // sharpness gain.
    let logoPath = path.join(process.cwd(), "public", "logo-pdf.png");
    if (!fs.existsSync(logoPath)) {
      logoPath = path.join(process.cwd(), "public", "logo.png");
    }
    if (fs.existsSync(logoPath)) {
      try {
        this.doc.image(logoPath, logoX, startY, { fit: [logoBox.w, logoBox.h], align: "right" });
      } catch {
        // Malformed/unreadable logo file — the rest of the document still
        // renders correctly without it.
      }
    }

    this.currentY = Math.max(y, startY + logoBox.h) + 8;
    this.hr(this.currentY, COLORS.primary, 1.5);
    this.currentY += 16;
  }

  /** Large centered bold green document title, e.g. "BILL OF SUPPLY". */
  renderDocumentTitle(title: string) {
    this.text(title.toUpperCase(), this.margin, this.currentY, {
      bold: true,
      size: 17,
      color: COLORS.primary,
      width: this.contentWidth,
      align: "center",
      characterSpacing: 0.5,
    });
    this.currentY += 26;
  }

  /**
   * N evenly-spaced compact info columns (e.g. Bill To / Transportation
   * Details / Invoice Details, or the Delivery Challan's four columns).
   */
  renderInfoColumns(columns: InfoColumn[]) {
    const gap = 10;
    const colWidth = (this.contentWidth - gap * (columns.length - 1)) / columns.length;
    const startY = this.currentY;

    // The heading itself can wrap to two lines in a narrow column (e.g. a
    // four-column challan header) — its own height must be included before
    // the first content line starts, or the two visually overlap. Line 0 of
    // the content is rendered bold (it's the customer/branch name), and
    // bold glyphs are wider than regular ones — measuring it with the
    // regular font under-counts how many lines it actually wraps to, which
    // is exactly what caused the next line to overlap it. Always measure
    // with the same font the line is rendered in.
    const lineHeight = (line: string, bold: boolean) =>
      this.doc
        .font(bold ? FONT_BOLD : FONT_REGULAR)
        .fontSize(8.5)
        .heightOfString(line, { width: colWidth });

    const headingHeight = (heading: string) => lineHeight(heading.toUpperCase(), true) + 5;

    const blockHeights = columns.map((col) => {
      const linesHeight = col.lines.reduce(
        (sum, line, idx) => sum + lineHeight(line, idx === 0) + 3,
        0,
      );
      return headingHeight(col.heading) + linesHeight;
    });
    const blockHeight = Math.max(...blockHeights, 30);
    const broke = this.ensureSpace(blockHeight, startY);
    const y0 = broke ? this.currentY : startY;

    columns.forEach((col, idx) => {
      const x = this.margin + idx * (colWidth + gap);
      this.text(col.heading.toUpperCase(), x, y0, { bold: true, size: 8.5, width: colWidth });
      let ly = y0 + headingHeight(col.heading);
      col.lines.forEach((line, lineIdx) => {
        const bold = lineIdx === 0;
        this.text(line, x, ly, { size: 8.5, bold, width: colWidth });
        ly += lineHeight(line, bold) + 3;
      });
    });

    this.currentY = y0 + blockHeight;

    const dividerY = this.currentY + 4;
    this.hr(dividerY, COLORS.border, 0.5);
    this.currentY = dividerY + 12;
  }

  /**
   * Full-width items table: solid green header with white bold text, plain
   * white rows with a hairline rule under each, and an optional TOTAL row
   * using the same column grid so figures line up exactly. Repeats the
   * header automatically on any page the table spills onto.
   */
  renderItemsTable(columns: PDFTableColumn[], rows: PDFTableRow[], totalRow?: PDFTableRow) {
    const widths = columns.map((col) => (col.width / 100) * this.contentWidth);
    const headerHeight = 20;

    const renderHeaderRow = (y: number) => {
      this.doc.rect(this.margin, y, this.contentWidth, headerHeight).fill(COLORS.primary);
      let x = this.margin;
      columns.forEach((col, idx) => {
        this.text(col.header.toUpperCase(), x + 6, y + 6, {
          bold: true,
          size: 8.5,
          color: COLORS.white,
          width: widths[idx] - 12,
          align: col.align || "left",
        });
        x += widths[idx];
      });
    };

    this.onNewPage = () => {
      renderHeaderRow(this.margin);
      this.currentY = this.margin + headerHeight;
    };

    // ensureSpace's onNewPage callback already draws the header row and
    // advances currentY when it breaks the page here — only draw it
    // ourselves when no break happened, or the header would render twice.
    const brokeAtStart = this.ensureSpace(headerHeight, this.currentY);
    if (!brokeAtStart) {
      renderHeaderRow(this.currentY);
      this.currentY += headerHeight;
    }
    let y = this.currentY;

    const rowHeight = (row: PDFTableRow, bold = false) => {
      const itemColIdx = columns.findIndex((c) => c.id === "item" || c.id === "garmentCode" || c.id === "name");
      const col = itemColIdx >= 0 ? columns[itemColIdx] : columns[0];
      const w = itemColIdx >= 0 ? widths[itemColIdx] : widths[0];
      const val = row[col.id] !== undefined ? String(row[col.id]) : "";
      const textHeight = this.doc
        .font(bold ? FONT_BOLD : FONT_REGULAR)
        .fontSize(8.5)
        .heightOfString(val, { width: w - 12 });
      return Math.max(20, textHeight + 9);
    };

    rows.forEach((row) => {
      const rh = rowHeight(row);
      if (this.ensureSpace(rh, y)) {
        y = this.currentY;
      }

      let x = this.margin;
      columns.forEach((col, idx) => {
        const w = widths[idx];
        const val = row[col.id] !== undefined ? String(row[col.id]) : "";
        const isItemCol = idx === 1;
        this.text(val, x + 6, y + 6, {
          bold: isItemCol,
          size: 8.5,
          width: w - 12,
          align: col.align || "left",
          // The item column sized this row and is allowed its full
          // height; every other column is capped and ellipsized so an
          // unexpectedly long value can never bleed into the row below.
          ...(isItemCol ? {} : { height: rh - 9, ellipsis: true }),
        });
        x += w;
      });

      this.doc
        .moveTo(this.margin, y + rh)
        .lineTo(this.margin + this.contentWidth, y + rh)
        .strokeColor(COLORS.border)
        .lineWidth(0.4)
        .stroke();

      y += rh;
    });

    if (totalRow) {
      const rh = rowHeight(totalRow, true) + 4;
      if (this.ensureSpace(rh + 6, y)) {
        y = this.currentY;
      }
      this.hr(y, COLORS.primary, 1);
      y += 6;

      let x = this.margin;
      columns.forEach((col, idx) => {
        const w = widths[idx];
        const val = totalRow[col.id] !== undefined ? String(totalRow[col.id]) : "";
        this.text(val, x + 6, y, {
          bold: true,
          size: 9,
          width: w - 12,
          align: col.align || "left",
        });
        x += w;
      });
      y += 16;
      this.hr(y, COLORS.primary, 1);
      y += 6;
    }

    this.onNewPage = null;
    this.currentY = y + 14;
  }

  /**
   * Financial documents (Bill of Supply, Payment Receipt): amount-in-words
   * and terms on the left, a right-aligned key/value stack ending in a
   * green-highlighted headline total on the right.
   */
  renderFinancialSummary(params: {
    amountWordsLabel: string;
    amountWords: string;
    terms?: string;
    lines: SummaryLine[];
  }) {
    const leftWidth = this.contentWidth * 0.56;
    const rightWidth = this.contentWidth - leftWidth - 16;
    const rightX = this.margin + leftWidth + 16;

    const lineRowHeight = (line: SummaryLine) => (line.highlight ? 24 : 15);
    const rightHeight = params.lines.reduce((sum, l) => sum + lineRowHeight(l), 0) + 4;

    // A large total spelled out ("Ten Thousand Nine Hundred Eighteen
    // Rupees...") can wrap to two lines — measure it so "Terms and
    // Conditions" starts below it instead of on top of it.
    const amountWordsHeight = this.doc.font(FONT_REGULAR).fontSize(9).heightOfString(params.amountWords, { width: leftWidth });
    const termsHeight = params.terms
      ? this.doc.font(FONT_REGULAR).fontSize(7.5).heightOfString(params.terms, { width: leftWidth }) + 24
      : 0;
    const leftHeight = 12 + amountWordsHeight + 8 + termsHeight;

    const blockHeight = Math.max(leftHeight, rightHeight);
    this.ensureSpace(blockHeight);
    const startY = this.currentY;

    // Left: Amount in Words + Terms & Conditions
    this.text(params.amountWordsLabel, this.margin, startY, { bold: true, size: 8.5 });
    this.text(params.amountWords, this.margin, startY + 12, { size: 9, width: leftWidth });

    if (params.terms) {
      const termsStartY = startY + 12 + amountWordsHeight + 8;
      this.text("Terms and Conditions", this.margin, termsStartY, { bold: true, size: 8.5 });
      this.text(params.terms, this.margin, termsStartY + 12, { size: 7.5, color: COLORS.muted, width: leftWidth });
    }

    // Right: key/value stack with a highlighted total row
    let ry = startY;
    params.lines.forEach((line) => {
      const h = lineRowHeight(line);
      if (line.highlight) {
        this.doc.rect(rightX, ry, rightWidth, h).fill(COLORS.primary);
        this.text(line.label.toUpperCase(), rightX + 8, ry + 6, { bold: true, size: 10, color: COLORS.white });
        this.text(line.value, rightX + 8, ry + 6, {
          bold: true,
          size: 10,
          color: COLORS.white,
          width: rightWidth - 16,
          align: "right",
        });
      } else {
        this.text(line.label, rightX + 8, ry + 2, { bold: Boolean(line.bold), size: 9 });
        this.text(line.value, rightX + 8, ry + 2, {
          bold: Boolean(line.bold),
          size: 9,
          width: rightWidth - 16,
          align: "right",
        });
      }
      ry += h;
    });

    this.currentY = startY + blockHeight + 14;
  }

  /**
   * Non-financial documents (Delivery Challan, Delivery Receipt): terms or
   * handling notes only — no subtotal/tax/paid/balance ever appears here.
   */
  renderNotesBlock(terms?: string) {
    if (!terms) return;
    const width = this.contentWidth;
    const height = this.doc.font(FONT_REGULAR).fontSize(7.5).heightOfString(terms, { width }) + 24;
    this.ensureSpace(height);
    const y = this.currentY;
    this.text("Terms and Conditions", this.margin, y, { bold: true, size: 8.5 });
    this.text(terms, this.margin, y + 12, { size: 7.5, color: COLORS.muted, width });
    this.currentY = y + height;
  }

  /**
   * Signature slots. A single signer (the Bill of Supply / Payment Receipt
   * pattern) sits bottom-right; multiple signers (Delivery Challan /
   * Delivery Receipt) spread evenly across the full width.
   */
  renderSignatureBlock(signers: Array<{ title: string; name?: string }>, align: "right" | "spread" = "right") {
    if (align === "right" && signers.length === 1) {
      const boxWidth = 220;
      const signer = signers[0];
      // A long branded name ("For: Aura Laundry - Koramangala Branch") can
      // wrap to two lines — measure it so the line and label underneath
      // are placed below it, never on top of it.
      const nameText = signer.name ? `For: ${signer.name}` : "";
      const nameHeight = nameText
        ? this.doc.font(FONT_BOLD).fontSize(9).heightOfString(nameText, { width: boxWidth })
        : 0;
      const lineOffset = nameHeight + 8;
      const blockHeight = lineOffset + 22;

      this.ensureSpace(blockHeight);
      const y = this.currentY;
      const x = this.margin + this.contentWidth - boxWidth;

      if (nameText) {
        this.text(nameText, x, y, { bold: true, size: 9, width: boxWidth, align: "center" });
      }
      this.doc
        .moveTo(x, y + lineOffset)
        .lineTo(x + boxWidth, y + lineOffset)
        .strokeColor(COLORS.border)
        .lineWidth(0.75)
        .stroke();
      this.text(signer.title, x, y + lineOffset + 6, { bold: true, size: 8.5, width: boxWidth, align: "center" });
      this.currentY = y + blockHeight;
      return;
    }

    const itemWidth = this.contentWidth / signers.length;
    const slotWidth = itemWidth - 10;

    const nameHeight = (name?: string) =>
      name ? this.doc.font(FONT_BOLD).fontSize(8).heightOfString(name, { width: slotWidth }) : 0;
    const maxNameHeight = Math.max(...signers.map((s) => nameHeight(s.name)), 0);
    const lineOffset = maxNameHeight + 6;
    const blockHeight = lineOffset + 24;

    this.ensureSpace(blockHeight);
    const y = this.currentY;

    signers.forEach((s, idx) => {
      const sx = this.margin + idx * itemWidth;
      const lineY = y + lineOffset;
      if (s.name) {
        this.text(s.name, sx + 5, y, { bold: true, size: 8, width: slotWidth, align: "center" });
      }
      this.doc
        .moveTo(sx + 10, lineY)
        .lineTo(sx + itemWidth - 10, lineY)
        .strokeColor(COLORS.border)
        .lineWidth(0.75)
        .stroke();
      this.text(s.title, sx + 5, lineY + 5, { bold: true, size: 8, width: slotWidth, align: "center" });
    });

    this.currentY = y + blockHeight;
  }

  /**
   * Finalizes the document. Page numbers are only stamped when the
   * document actually spans more than one page — a single-page document
   * (the common case for a short item list) gets no footer clutter at all.
   */
  async build(): Promise<Buffer> {
    const pages = this.doc.bufferedPageRange();

    if (pages.count > 1) {
      for (let i = 0; i < pages.count; i++) {
        this.doc.switchToPage(i);
        // Must stay inside the document's own bottom margin
        // (pageHeight - margin) — that exact line is also where PDFKit's
        // own auto-pagination trigger lives, and text placed past it (as
        // this used to be, at margin + 6) makes PDFKit silently insert a
        // fresh blank page to keep "flowing" it, doubling the real page
        // count with blank pages that carry only a footer.
        this.text(`Page ${i + 1} of ${pages.count}`, this.margin, this.pageHeight - this.margin - 14, {
          size: 7.5,
          color: COLORS.muted,
          width: this.contentWidth,
          align: "right",
          lineBreak: false,
        });
      }
    }

    this.doc.end();

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      this.doc.on("data", (chunk) => chunks.push(chunk));
      this.doc.on("end", () => resolve(Buffer.concat(chunks)));
      this.doc.on("error", (err) => reject(err));
    });
  }
}

export { amountInWordsHelper as amountInWords };
