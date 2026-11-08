import "server-only";

import path from "path";
import PDFDocument from "pdfkit";
import { prisma } from "@/lib/prisma";
import { amountInWords as amountInWordsHelper } from "@/lib/money";
import { loadFirmImage } from "./firm-assets";

/**
 * Neutral defaults only. Brand colour, logo, name, address and terms always
 * come from the firm's own settings (see getCompanyProfile) — nothing here
 * names or depicts any particular firm.
 */
export const DEFAULT_ACCENT = "#068708";

export const COLORS = {
  ink: "#000000",
  muted: "#3f3f3f",
  rule: "#808080",
  white: "#ffffff",
};

// Roboto (the reference documents' typeface) covers Latin text; the Rupee
// sign (U+20B9) and any other glyph Roboto lacks is drawn from DejaVu Sans,
// bundled so output never depends on fonts installed on the host.
const FONT_REGULAR = "Roboto";
const FONT_BOLD = "Roboto-Bold";
const FALLBACK_REGULAR = "DejaVuSans";
const FALLBACK_BOLD = "DejaVuSans-Bold";

import type { CompanyProfile } from "./types";
export type { CompanyProfile };

export type PDFLayout = "a4" | "a5-on-a4";

export interface TermsAndSignatureParams {
  terms?: string;
  forName: string;
  title?: string;
  termsHeading?: string;
}

export interface FinancialSummaryParams {
  amountWordsLabel: string;
  amountWords: string;
  terms?: string;
  lines: SummaryLine[];
  /** Signatory caption drawn under the totals, kept on the same page as them. */
  signatory?: { forName: string; title?: string };
}

export interface BranchProfile {
  name: string;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
  email?: string | null;
}

const DEFAULT_TERMS =
  "1. No guarantee against colour loss, bleeding & shrinkage.\n2. In case of rare damage, the company's liability shall be limited to a maximum of eight (8) times the processing (laundry/dry clean) cost.";

function validAccent(value: string | undefined): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : DEFAULT_ACCENT;
}

/**
 * Every PDF must reflect only the firm it was generated for. Callers always
 * pass the firmId straight from the record the document is for (invoice.firmId,
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
    prisma.firm.findUnique({
      where: { id: firmId },
      select: {
        name: true,
        legalName: true,
        addressLine: true,
        city: true,
        state: true,
        pincode: true,
        phone: true,
        email: true,
        website: true,
        gstin: true,
        pan: true,
        logoUrl: true,
      },
    }),
  ]);

  const map = new Map(settings.map((s) => [s.key, s.value]));
  const firmAddress = firm ? [firm.addressLine, firm.city, firm.state, firm.pincode].filter(Boolean).join(", ") : "";

  return {
    name: map.get("company_name") || map.get("app_name") || firm?.name || "",
    legalName: firm?.legalName || "",
    address: map.get("company_address") || firmAddress || "",
    phone: map.get("company_phone") || firm?.phone || "",
    email: map.get("company_email") || firm?.email || "",
    website: map.get("company_website") || firm?.website || "",
    gstin: map.get("company_gstin") || firm?.gstin || "",
    pan: firm?.pan || "",
    // No platform fallback: an unconfigured firm prints no logo.
    logoUrl: map.get("company_logo") || firm?.logoUrl || "",
    signatureUrl: map.get("company_signature") || "",
    accentColor: validAccent(map.get("document_accent_color")),
    footerText: map.get("document_footer_text") || "",
    termsConditions: map.get("document_terms") || DEFAULT_TERMS,
    invoicePrefix: map.get("invoice_prefix") || "INV",
    challanPrefix: map.get("challan_prefix") || "DC",
    receiptPrefix: map.get("receipt_prefix") || "REC",
    currency: map.get("default_currency") || "INR",
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
  highlight?: boolean; // accent background, white text — the document's headline figure
}

type TextOpts = PDFKit.Mixins.TextOptions & { bold?: boolean; size?: number; color?: string };

/**
 * Shared PDFKit assembly for every business document. The layout is
 * authored in the coordinate space of the approved reference documents
 * (420 x 595 pt) and scaled uniformly onto a true A4 page, so proportions,
 * spacing and typography match the references while the output is a real
 * A4 document with selectable text and vector rules.
 */
export class PDFDocumentBuilder {
  doc: InstanceType<typeof PDFDocument>;
  company: CompanyProfile;

  /**
   * "a5-on-a4": the layout is authored in the reference challan's A5-width
   * design space and scaled uniformly onto a true A4 page (identical to
   * printing the A5 reference "fit to A4"). "a4": native A4 geometry with
   * the same typography and structure, for documents whose reference is A4.
   */
  readonly pageWidth: number;
  readonly pageHeight: number;
  private readonly scale: number;

  readonly marginX: number; // where rules and the table bar start
  readonly inset = 3; // text inset inside rules/bars
  readonly top = 30;
  readonly bottom = 24;
  readonly contentWidth: number;
  readonly innerLeft: number;
  readonly innerRight: number;
  readonly accent: string;
  /** Lowest y body content may reach before a new page. */
  readonly maxY: number;

  currentY: number;

  private logo: Buffer | null = null;
  private signature: Buffer | null = null;
  private onNewPage: (() => void) | null = null;
  private robotoFont: { hasGlyphForCodePoint(cp: number): boolean } | null = null;
  private glyphCache = new Map<number, boolean>();

  private constructor(company: CompanyProfile, title: string, layout: PDFLayout) {
    this.company = company;
    this.scale = layout === "a4" ? 1 : 595.28 / 419.53;
    this.pageWidth = 595.28 / this.scale;
    this.pageHeight = 841.89 / this.scale;
    this.marginX = layout === "a4" ? 28 : 25;
    this.accent = validAccent(company.accentColor);
    this.contentWidth = this.pageWidth - this.marginX * 2;
    this.innerLeft = this.marginX + this.inset;
    this.innerRight = this.pageWidth - this.marginX - 2;
    this.maxY = this.pageHeight - this.bottom;
    this.currentY = this.top;

    this.doc = new PDFDocument({
      size: "A4",
      // Margins are managed by this class (in design units); zero here keeps
      // PDFKit's own flow/auto-pagination out of the picture entirely.
      margin: 0,
      bufferPages: true,
      info: {
        Title: title,
        Author: company.name,
        Creator: "Laundry OS Document System",
      },
    });
    this.doc.scale(this.scale);
    this.doc.on("pageAdded", () => {
      this.doc.scale(this.scale);
    });

    const fonts = path.join(process.cwd(), "public", "fonts");
    this.doc.registerFont(FONT_REGULAR, path.join(fonts, "Roboto-Regular.woff"));
    this.doc.registerFont(FONT_BOLD, path.join(fonts, "Roboto-Bold.woff"));
    this.doc.registerFont(FALLBACK_REGULAR, path.join(fonts, "DejaVuSans.ttf"));
    this.doc.registerFont(FALLBACK_BOLD, path.join(fonts, "DejaVuSans-Bold.ttf"));
    this.doc.font(FONT_REGULAR);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.robotoFont = (this.doc as any)._font?.font ?? null;
  }

  /** Builder for one firm's document; loads that firm's own logo/signature. */
  static async create(company: CompanyProfile, title: string, layout: PDFLayout = "a4"): Promise<PDFDocumentBuilder> {
    const builder = new PDFDocumentBuilder(company, title, layout);
    const [logo, signature] = await Promise.all([
      loadFirmImage(company.logoUrl),
      loadFirmImage(company.signatureUrl),
    ]);
    builder.logo = logo;
    builder.signature = signature;
    return builder;
  }

  // ---------------------------------------------------------------- text --

  private supports(ch: string): boolean {
    const cp = ch.codePointAt(0)!;
    if (cp < 32 || ch === "\n" || ch === "\t") return true;
    const cached = this.glyphCache.get(cp);
    if (cached !== undefined) return cached;
    const ok = this.robotoFont ? this.robotoFont.hasGlyphForCodePoint(cp) : true;
    this.glyphCache.set(cp, ok);
    return ok;
  }

  private fullySupported(value: string): boolean {
    for (const ch of value) if (!this.supports(ch)) return false;
    return true;
  }

  private fontFor(value: string, bold: boolean): string {
    if (this.fullySupported(value)) return bold ? FONT_BOLD : FONT_REGULAR;
    return bold ? FALLBACK_BOLD : FALLBACK_REGULAR;
  }

  private heightOf(value: string, size: number, width: number, bold = false, lineGap = 0): number {
    return this.doc.font(this.fontFor(value, bold)).fontSize(size).heightOfString(value, { width, lineGap });
  }

  private widthOf(value: string, size: number, bold = false): number {
    return this.doc.font(this.fontFor(value, bold)).fontSize(size).widthOfString(value);
  }

  /** Splits a string into runs that each use a single font. */
  private runs(value: string, bold: boolean): Array<{ text: string; font: string }> {
    const out: Array<{ text: string; font: string }> = [];
    for (const ch of value) {
      const font = this.supports(ch)
        ? bold
          ? FONT_BOLD
          : FONT_REGULAR
        : bold
          ? FALLBACK_BOLD
          : FALLBACK_REGULAR;
      const last = out[out.length - 1];
      if (last && last.font === font) last.text += ch;
      else out.push({ text: ch, font });
    }
    return out;
  }

  private text(value: string, x: number, y: number, opts: TextOpts = {}) {
    const { bold, size, color, ...rest } = opts;
    const fontSize = size ?? 9;
    this.doc.fillColor(color ?? COLORS.ink).fontSize(fontSize);

    if (this.fullySupported(value)) {
      this.doc.font(bold ? FONT_BOLD : FONT_REGULAR).text(value, x, y, rest);
      return;
    }

    // Mixed-script, single-line values (every amount that contains the
    // Rupee sign): draw run by run so digits keep Roboto and only the
    // missing glyph comes from the fallback font.
    const singleLine = !value.includes("\n");
    if (singleLine) {
      const runs = this.runs(value, Boolean(bold));
      const total = runs.reduce((sum, r) => sum + this.doc.font(r.font).fontSize(fontSize).widthOfString(r.text), 0);
      const boxWidth = rest.width ?? total;
      if (total <= boxWidth + 0.5) {
        let cx = x;
        if (rest.align === "right") cx = x + boxWidth - total;
        else if (rest.align === "center") cx = x + (boxWidth - total) / 2;
        for (const r of runs) {
          this.doc.font(r.font).fontSize(fontSize).fillColor(color ?? COLORS.ink);
          this.doc.text(r.text, cx, y, { lineBreak: false, characterSpacing: rest.characterSpacing });
          cx += this.doc.widthOfString(r.text);
        }
        return;
      }
    }
    this.doc.font(bold ? FALLBACK_BOLD : FALLBACK_REGULAR).text(value, x, y, rest);
  }

  private line(y: number, color: string = COLORS.rule, width = 0.5) {
    this.doc
      .moveTo(this.marginX, y)
      .lineTo(this.pageWidth - this.marginX, y)
      .strokeColor(color)
      .lineWidth(width)
      .stroke();
  }

  /** Starts a new page when `height` more content would cross maxY. */
  private ensureSpace(height: number, y?: number): boolean {
    const at = y ?? this.currentY;
    if (at + height <= this.maxY) return false;
    this.doc.addPage();
    this.currentY = this.top;
    if (this.onNewPage) this.onNewPage();
    return true;
  }

  // -------------------------------------------------------------- header --

  /**
   * Firm name + branch, address and contact details on the left; the firm's
   * own logo on the right (aspect ratio preserved); accent rule beneath.
   */
  renderCompanyHeader(branch: BranchProfile) {
    const startY = this.currentY;
    const logoBox = { w: 60, h: 48 };
    // The reference wraps the name/address block at roughly this width.
    const textWidth = Math.min(this.contentWidth - logoBox.w - 24, 175 * (this.pageWidth / 419.53));

    const title = [this.company.name, branch.name].filter(Boolean).join(" - ");
    this.text(title, this.innerLeft, startY, { bold: true, size: 13.5, width: textWidth, lineGap: 0.7 });
    let y = startY + this.heightOf(title, 13.5, textWidth, true, 0.7) + 2;

    const addressParts = [branch.addressLine, branch.city, branch.state, branch.pincode].filter(Boolean);
    const address = addressParts.length > 0 ? addressParts.join(", ") : this.company.address;
    if (address) {
      this.text(address, this.innerLeft, y, { size: 8.7, width: textWidth });
      y += this.heightOf(address, 8.7, textWidth) + 3.3;
    }

    const phone = branch.phone || this.company.phone;
    if (phone) {
      this.text(`Phone no.: ${phone}`, this.innerLeft, y, { size: 8.7, width: textWidth });
      y += 12.8;
    }

    const email = branch.email || this.company.email;
    if (email) {
      this.text(`Email: ${email}`, this.innerLeft, y, { size: 8.7, width: textWidth });
      y += 12.8;
    }

    const taxLine = this.company.gstin ? `GSTIN: ${this.company.gstin}` : "";
    if (taxLine) {
      this.text(taxLine, this.innerLeft, y, { size: 8.7, width: textWidth });
      y += 12.8;
    }

    const blockHeight = Math.max(y - startY - 3, 0);
    if (this.logo) {
      const boxTop = startY + Math.max(0, (blockHeight - logoBox.h) / 2);
      try {
        this.doc.image(this.logo, this.innerRight - logoBox.w, boxTop, {
          fit: [logoBox.w, logoBox.h],
          align: "right",
          valign: "center",
        });
      } catch {
        // Unreadable logo — the document still renders without it.
      }
    }

    this.currentY = Math.max(y, this.logo ? startY + logoBox.h : 0) + 1;
    this.line(this.currentY, this.accent, 0.5);
    this.currentY += 4;
  }

  /** Centered bold accent-coloured document title. */
  renderDocumentTitle(title: string) {
    this.text(title, this.marginX, this.currentY, {
      bold: true,
      size: 15.5,
      color: this.accent,
      width: this.contentWidth,
      align: "center",
    });
    this.currentY += 18.5 + 13;
  }

  /**
   * Compact info columns (e.g. "Delivery Challan for" / "Transportation
   * Details" / "Challan Details"). The first line of each column is bold, the
   * last column is right-aligned to the page edge, as in the references.
   */
  renderInfoColumns(columns: InfoColumn[]) {
    const n = columns.length;
    const gapMin = 10;
    const innerWidth = this.innerRight - this.innerLeft;

    // Natural (unwrapped) width of each column: its widest line. Left-hand
    // columns may wrap (a long address); the right-hand column never does.
    const natural = columns.map((col, i) =>
      Math.min(
        Math.max(
          this.widthOf(col.heading, 9, true),
          ...col.lines.map((l, idx) => this.widthOf(l, 9, idx === 0 && i === 0)),
        ) + 1,
        i === n - 1 ? innerWidth * 0.45 : innerWidth * 0.34,
      ),
    );

    // Left edge of each column and its wrap width.
    let xs: number[];
    let widths: number[];
    const lastW = natural[n - 1];
    const refX2 = this.innerLeft + innerWidth * 0.376; // reference position of the middle column
    if (n === 3 && natural[0] + gapMin <= refX2 - this.innerLeft && natural[1] + gapMin <= this.innerRight - lastW - refX2) {
      xs = [this.innerLeft, refX2, this.innerRight - lastW];
      widths = [refX2 - this.innerLeft - gapMin, this.innerRight - lastW - refX2 - gapMin, lastW];
    } else {
      const leftTotal = natural.slice(0, n - 1).reduce((a, b) => a + b, 0);
      const room = innerWidth - gapMin * (n - 1) - (n > 1 ? lastW : 0);
      const shrink = n > 1 && leftTotal > room ? room / leftTotal : 1;
      widths = natural.map((w, i) => (i === n - 1 ? w : w * shrink));
      const gap = n > 1 ? (innerWidth - widths.reduce((a, b) => a + b, 0)) / (n - 1) : 0;
      xs = [];
      let cursor = this.innerLeft;
      widths.forEach((w) => {
        xs.push(cursor);
        cursor += w + gap;
      });
      if (n > 1) xs[n - 1] = this.innerRight - widths[n - 1];
    }

    const geometry = columns.map((_, i) => ({
      x: xs[i],
      width: widths[i] + (i === n - 1 ? 0 : 1),
      align: n > 1 && i === n - 1 ? ("right" as const) : ("left" as const),
    }));

    const headingH = (heading: string, w: number) => this.heightOf(heading, 9, w, true) + 5.8;
    const lineH = (line: string, bold: boolean, w: number) => this.heightOf(line, 9, w, bold) + 4.8;
    const isBoldLine = (colIdx: number, lineIdx: number) => colIdx === 0 && lineIdx === 0;

    const heights = columns.map((col, i) => {
      const g = geometry[i];
      return (
        headingH(col.heading, g.width) +
        col.lines.reduce((sum, line, idx) => sum + lineH(line, isBoldLine(i, idx), g.width), 0)
      );
    });
    const blockHeight = Math.max(...heights, 30);
    this.ensureSpace(blockHeight);
    const y0 = this.currentY;

    columns.forEach((col, i) => {
      const g = geometry[i];
      this.text(col.heading, g.x, y0, { bold: true, size: 9, width: g.width, align: g.align });
      let ly = y0 + headingH(col.heading, g.width);
      col.lines.forEach((line, idx) => {
        const bold = idx === 0 && i === 0;
        this.text(line, g.x, ly, { size: 9, bold, width: g.width, align: g.align });
        ly += lineH(line, bold, g.width);
      });
    });

    this.currentY = y0 + blockHeight + 4;
  }

  // --------------------------------------------------------------- table --

  /**
   * Accent header bar with white bold labels, borderless rows with bold item
   * names, then a ruled TOTAL row on the same column grid. The header bar is
   * repeated on every continuation page, and the TOTAL row is never left
   * alone on a page: the last data row travels with it.
   */
  renderItemsTable(
    columns: PDFTableColumn[],
    rows: PDFTableRow[],
    totalRow?: PDFTableRow,
    /** Height of the block that follows the table; the last row travels with it. */
    reserveBelow = 0,
  ) {
    const widths = columns.map((col) => (col.width / 100) * this.contentWidth);
    const headerHeight = 19;
    const minRow = 19.7;
    const totalBlock = 6 + 10.8 + 4.6 + 1;

    const colX = (idx: number) => this.marginX + widths.slice(0, idx).reduce((a, b) => a + b, 0);
    const cellOpts = (idx: number) => {
      const align = columns[idx].align || "left";
      const x = align === "right" ? colX(idx) : colX(idx) + this.inset;
      const w = align === "right" ? widths[idx] - 2 - 0 : widths[idx] - this.inset - 2;
      return { x, w, align };
    };

    const drawHeader = (y: number) => {
      this.doc.rect(this.marginX, y, this.contentWidth, headerHeight).fill(this.accent);
      columns.forEach((col, idx) => {
        const c = cellOpts(idx);
        this.text(col.header, c.x, y + 4.2, { bold: true, size: 9, color: COLORS.white, width: c.w, align: c.align });
      });
    };

    this.onNewPage = () => {
      drawHeader(this.currentY);
      this.currentY += headerHeight;
    };

    if (!this.ensureSpace(headerHeight + minRow)) {
      drawHeader(this.currentY);
      this.currentY += headerHeight;
    }
    let y = this.currentY;

    const itemIdx = Math.max(
      columns.findIndex((c) => c.id === "item" || c.id === "garmentCode" || c.id === "name"),
      0,
    );
    const rowHeight = (row: PDFTableRow, bold: boolean) => {
      const val = row[columns[itemIdx].id] !== undefined ? String(row[columns[itemIdx].id]) : "";
      return Math.max(minRow, this.heightOf(val, 9, cellOpts(itemIdx).w, bold) + 8.9);
    };

    rows.forEach((row, rIdx) => {
      const rh = rowHeight(row, true);
      const isLast = rIdx === rows.length - 1;
      this.currentY = y;
      if (this.ensureSpace(rh + (isLast && totalRow ? totalBlock + reserveBelow : 0))) {
        y = this.currentY;
      }

      columns.forEach((col, idx) => {
        const c = cellOpts(idx);
        const val = row[col.id] !== undefined ? String(row[col.id]) : "";
        const isItem = idx === itemIdx;
        this.text(val, c.x, y + 3.9, {
          bold: isItem,
          size: 9,
          width: c.w,
          align: c.align,
          // Only the item column may wrap; every other cell is capped so an
          // unexpectedly long value can never run into the row beneath it.
          ...(isItem ? {} : { height: rh - 6, ellipsis: true }),
        });
      });
      y += rh;
    });

    if (totalRow) {
      this.currentY = y;
      if (this.ensureSpace(totalBlock)) y = this.currentY;
      this.line(y, COLORS.rule, 0.5);
      y += 5;
      columns.forEach((col, idx) => {
        const c = cellOpts(idx);
        const val = totalRow[col.id] !== undefined ? String(totalRow[col.id]) : "";
        this.text(val, c.x, y, { bold: true, size: 9, width: c.w, align: c.align });
      });
      y += 10.8 + 4.6;
      this.line(y, COLORS.rule, 0.5);
    }

    this.onNewPage = null;
    this.currentY = y + 14.7;
  }

  // ----------------------------------------------------------- summaries --

  /**
   * Financial documents: amount-in-words and terms on the left, a
   * right-aligned key/value stack ending in an accent-highlighted headline
   * total on the right.
   */
  measureFinancialSummary(params: FinancialSummaryParams): number {
    return this.summaryLayout(params).blockHeight + 8;
  }

  private summaryLayout(params: FinancialSummaryParams) {
    const leftWidth = this.contentWidth * 0.55;
    const rightWidth = this.contentWidth - leftWidth - 14;
    const rightX = this.marginX + leftWidth + 14;

    const rowH = (line: SummaryLine) => (line.highlight ? 20 : 14.5);
    const rightHeight = params.lines.reduce((sum, l) => sum + rowH(l), 0) + 4;

    const wordsHeight = this.heightOf(params.amountWords, 9, leftWidth - this.inset);
    const terms = params.terms ? normaliseTerms(params.terms) : "";
    const termsHeight = terms ? this.heightOf(terms, 8, leftWidth - this.inset) + 20 : 0;
    const leftHeight = 15 + wordsHeight + 8 + termsHeight;

    const forText = params.signatory ? `For: ${params.signatory.forName}` : "";
    const forHeight = forText ? this.heightOf(forText, 9, rightWidth) : 0;
    const sigHeight = params.signatory ? forHeight + (this.signature ? 46 : 28) + 11 : 0;
    const sigTop = rightHeight + 8;

    const blockHeight = Math.max(leftHeight, params.signatory ? sigTop + sigHeight : rightHeight);
    return { leftWidth, rightWidth, rightX, rowH, wordsHeight, terms, forText, forHeight, sigHeight, sigTop, blockHeight };
  }

  renderFinancialSummary(params: FinancialSummaryParams) {
    const { leftWidth, rightWidth, rightX, rowH, wordsHeight, terms, forText, forHeight, sigHeight, sigTop, blockHeight } =
      this.summaryLayout(params);
    this.ensureSpace(blockHeight);
    const startY = this.currentY;

    this.text(params.amountWordsLabel, this.innerLeft, startY, { bold: true, size: 9 });
    this.text(params.amountWords, this.innerLeft, startY + 14, { size: 9, width: leftWidth - this.inset });

    if (terms) {
      const termsY = startY + 14 + wordsHeight + 8;
      this.text("Terms And Conditions", this.innerLeft, termsY, { bold: true, size: 9 });
      this.text(terms, this.innerLeft, termsY + 14, { size: 8, width: leftWidth - this.inset });
    }

    let ry = startY;
    params.lines.forEach((line) => {
      const h = rowH(line);
      if (line.highlight) {
        this.doc.rect(rightX, ry, rightWidth, h).fill(this.accent);
        this.text(line.label, rightX + 6, ry + 5, { bold: true, size: 10, color: COLORS.white });
        this.text(line.value, rightX + 6, ry + 5, {
          bold: true,
          size: 10,
          color: COLORS.white,
          width: rightWidth - 12,
          align: "right",
        });
      } else {
        this.text(line.label, rightX + 6, ry + 2, { bold: Boolean(line.bold), size: 9 });
        this.text(line.value, rightX + 6, ry + 2, {
          bold: Boolean(line.bold),
          size: 9,
          width: rightWidth - 12,
          align: "right",
        });
      }
      ry += h;
    });

    if (params.signatory) {
      const sy = startY + sigTop;
      this.text(forText, rightX, sy, { size: 9, width: rightWidth, align: "center" });
      if (this.signature) {
        try {
          this.doc.image(this.signature, rightX + (rightWidth - 110) / 2, sy + forHeight + 3, {
            fit: [110, 40],
            align: "center",
            valign: "center",
          });
        } catch {
          // Unreadable signature image — the caption still prints.
        }
      }
      this.text(params.signatory.title ?? "Authorized Signatory", rightX, sy + sigHeight - 11, {
        bold: true,
        size: 9,
        width: rightWidth,
        align: "center",
      });
    }

    this.currentY = startY + blockHeight + 8;
  }

  /**
   * The reference footer: "Terms And Conditions" on the left; on the right
   * "For: <firm - branch>" centred above the firm's signature/stamp (when
   * configured) and the bold signatory caption.
   */
  measureTermsAndSignature(params: TermsAndSignatureParams): number {
    return this.termsLayout(params).blockHeight + 8;
  }

  private termsLayout(params: TermsAndSignatureParams) {
    const leftWidth = 180;
    const rightX = 224;
    const rightWidth = this.innerRight - rightX;
    const terms = params.terms ? normaliseTerms(params.terms) : "";
    const leftHeight = terms ? 15.7 + this.heightOf(terms, 9, leftWidth) : 0;
    const forText = `For: ${params.forName}`;
    const forHeight = this.heightOf(forText, 9, rightWidth);
    const rightHeight = forHeight + (this.signature ? 46 : 28) + 14.6;
    return { leftWidth, rightX, rightWidth, terms, forText, forHeight, blockHeight: Math.max(leftHeight, rightHeight) };
  }

  renderTermsAndSignature(params: TermsAndSignatureParams) {
    const title = params.title ?? "Authorized Signatory";
    const termsHeading = params.termsHeading ?? "Terms And Conditions";
    const { leftWidth, rightX, rightWidth, terms, forText, forHeight, blockHeight } = this.termsLayout(params);

    this.ensureSpace(blockHeight);
    const y = this.currentY;

    if (terms) {
      this.text(termsHeading, this.innerLeft - 0.4, y, { bold: true, size: 9 });
      this.text(terms, this.innerLeft - 0.4, y + 15.7, { size: 9, width: leftWidth });
    }

    this.text(forText, rightX, y, { size: 9, width: rightWidth, align: "center" });
    if (this.signature) {
      const top = y + forHeight + 4;
      const bottom = y + blockHeight - 14.6 - 3;
      try {
        this.doc.image(this.signature, rightX + (rightWidth - 110) / 2, top, {
          fit: [110, Math.max(bottom - top, 24)],
          align: "center",
          valign: "bottom",
        });
      } catch {
        // Unreadable signature image — the caption still prints.
      }
    }
    this.text(title, rightX, y + blockHeight - 14.6, { bold: true, size: 9, width: rightWidth, align: "center" });

    this.currentY = y + blockHeight + 8;
  }

  /** @deprecated kept for non-challan documents; prefer renderTermsAndSignature. */
  renderNotesBlock(terms?: string) {
    if (!terms) return;
    const text = normaliseTerms(terms);
    const height = this.heightOf(text, 8, this.contentWidth) + 20;
    this.ensureSpace(height);
    const y = this.currentY;
    this.text("Terms And Conditions", this.innerLeft, y, { bold: true, size: 9 });
    this.text(text, this.innerLeft, y + 14, { size: 8, width: this.contentWidth - this.inset });
    this.currentY = y + height;
  }

  /**
   * Signature slots. A single signer (Bill of Supply / receipts) sits
   * bottom-right in the reference style; several signers spread evenly.
   */
  renderSignatureBlock(signers: Array<{ title: string; name?: string }>, align: "right" | "spread" = "right") {
    if (align === "right" && signers.length === 1) {
      this.renderTermsAndSignature({ forName: signers[0].name ?? this.company.name, title: signers[0].title });
      return;
    }

    const itemWidth = this.contentWidth / signers.length;
    const slotWidth = itemWidth - 10;
    const nameHeight = (name?: string) => (name ? this.heightOf(name, 8, slotWidth, true) : 0);
    const maxNameHeight = Math.max(...signers.map((s) => nameHeight(s.name)), 0);
    const lineOffset = maxNameHeight + 22;
    const blockHeight = lineOffset + 20;

    this.ensureSpace(blockHeight);
    const y = this.currentY;

    signers.forEach((s, idx) => {
      const sx = this.marginX + idx * itemWidth;
      const lineY = y + lineOffset;
      if (s.name) this.text(s.name, sx + 5, y, { bold: true, size: 8, width: slotWidth, align: "center" });
      this.doc
        .moveTo(sx + 10, lineY)
        .lineTo(sx + itemWidth - 10, lineY)
        .strokeColor(COLORS.rule)
        .lineWidth(0.5)
        .stroke();
      this.text(s.title, sx + 5, lineY + 4, { bold: true, size: 8, width: slotWidth, align: "center" });
    });

    this.currentY = y + blockHeight;
  }

  /**
   * Finalises the document. "Page n of m" is stamped only when the document
   * really spans more than one page.
   */
  async build(): Promise<Buffer> {
    const pages = this.doc.bufferedPageRange();

    if (pages.count > 1) {
      for (let i = 0; i < pages.count; i++) {
        this.doc.switchToPage(i);
        this.text(`Page ${i + 1} of ${pages.count}`, this.marginX, this.pageHeight - 20, {
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

/**
 * Terms are stored one clause per line; the references print a blank line
 * between clauses.
 */
export function normaliseTerms(terms: string): string {
  return terms
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n\n");
}

export { amountInWordsHelper as amountInWords };
