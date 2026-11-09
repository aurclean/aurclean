/**
 * Real-database acceptance tests for the Invoice and Delivery Challan PDFs.
 *
 *   DATABASE_URL=postgresql://... npm run test:documents
 *
 * Creates two independent firms (with their own branches, customers, orders,
 * invoices and challans) in the configured database, generates the actual PDF
 * buffers, and inspects them with poppler (pdftotext / pdfimages / pdfinfo).
 * Everything it creates is removed afterwards.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import zlib from "node:zlib";

import { prisma } from "@/lib/prisma";
import { generateChallanPDF, generateInvoicePDF, DocumentAccessError } from "@/lib/pdf/pdf-templates";
import { nextChallanNumber, nextInvoiceNumber } from "@/lib/sequence";

const RUN = Date.now().toString(36);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docs-test-"));

/** Solid-colour PNG as a data: URI — a distinct, verifiable logo per firm. */
function solidPng(r: number, g: number, b: number, size = 120): string {
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

interface Fixture {
  firmId: string;
  name: string;
  branchId: string;
  branchName: string;
  customerId: string;
  orderId: string;
  invoiceId: string;
  invoiceNumber: string;
  challanId: string;
  challanNumber: string;
  longChallanId: string;
}

const created: { firms: string[] } = { firms: [] };
let A: Fixture;
let B: Fixture;

async function makeFirm(tag: string, opts: { name: string; branch: string; gstin: string; phone: string; logo: string; accent: string; challanPrefix: string; invoicePrefix: string; address: string }): Promise<Fixture> {
  const firm = await prisma.firm.create({
    data: {
      code: `T${tag}${RUN}`.toUpperCase().slice(0, 20),
      name: opts.name,
      gstin: opts.gstin || null,
      phone: opts.phone,
      email: `${tag}@example.test`,
      addressLine: opts.address,
      city: "Mangaluru",
      pincode: "575002",
    },
  });
  created.firms.push(firm.id);
  const firmId = firm.id;

  for (const [key, value, category] of [
    ["company_logo", opts.logo, "company"],
    ["document_accent_color", opts.accent, "documents"],
    ["challan_prefix", opts.challanPrefix, "documents"],
    ["invoice_prefix", opts.invoicePrefix, "documents"],
    ["document_terms", `1. ${opts.name} terms clause one.\n2. ${opts.name} terms clause two.`, "documents"],
  ] as const) {
    await prisma.setting.create({ data: { firmId, key, value, category } });
  }

  const branch = await prisma.branch.create({
    data: { firmId, code: `B${tag}${RUN}`, name: opts.branch, addressLine: opts.address, city: "Mangaluru", pincode: "575002", phone: opts.phone, gstNumber: opts.gstin || null },
  });
  const customer = await prisma.customer.create({
    data: { firmId, code: `C${tag}${RUN}`, branchId: branch.id, name: `Cust ${tag}`, phone: "7022897801", outstandingAmount: 0 },
  });
  const gt = await prisma.garmentType.create({ data: { firmId, code: `GT${tag}${RUN}`, name: "Shirt" } });
  const gt2 = await prisma.garmentType.create({ data: { firmId, code: `GU${tag}${RUN}`, name: "Kids Shirt" } });
  const svc = await prisma.service.create({ data: { firmId, code: `SV${tag}${RUN}`, name: "Steam Press", basePrice: 25 } });

  const order = await prisma.order.create({
    data: {
      firmId,
      orderNumber: `ORD-${tag}-${RUN}`,
      branchId: branch.id,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      expectedDeliveryAt: new Date("2026-10-23T10:00:00Z"),
      subtotal: 225.5,
      discountAmount: 0,
      taxableAmount: 225.5,
      gstRate: opts.gstin ? 18 : 0,
      gstAmount: opts.gstin ? 40.59 : 0,
      totalAmount: opts.gstin ? 266.09 : 225.5,
      items: {
        create: [
          { firmId, serviceId: svc.id, garmentTypeId: gt2.id, quantity: 4, unitPrice: 25, lineTotal: 100 },
          { firmId, serviceId: svc.id, garmentTypeId: gt.id, quantity: 5, unitPrice: 25.1, lineTotal: 125.5 },
        ],
      },
    },
  });

  const invoiceNumber = await nextInvoiceNumber(prisma, firmId);
  const gst = opts.gstin ? 40.59 : 0;
  const invoice = await prisma.invoice.create({
    data: {
      firmId,
      invoiceNumber,
      branchId: branch.id,
      orderId: order.id,
      customerId: customer.id,
      billToName: customer.name,
      billToPhone: customer.phone,
      subtotal: 225.5,
      taxableAmount: 225.5,
      gstRate: opts.gstin ? 18 : 0,
      cgstAmount: gst / 2,
      sgstAmount: gst / 2,
      totalAmount: 225.5 + gst,
      amountPaid: 100,
      amountDue: 125.5 + gst,
    },
  });

  const challanNumber = await nextChallanNumber(prisma, firmId);
  const mkItem = (i: number, desc: string) => ({
    garmentCode: `G${tag}${RUN}${i}`,
    category: desc,
    description: desc,
    service: "Steam Press",
    quantity: 1,
    unitPrice: 25,
    amount: 25,
  });
  const challan = await prisma.deliveryChallan.create({
    data: {
      firmId,
      challanNumber,
      orderId: order.id,
      branchId: branch.id,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerAddress: "12 Main Road, Jeppu",
      challanDate: new Date("2026-10-21T13:49:00"),
      deliveryDate: new Date("2026-10-23T10:00:00"),
      subtotal: 999,
      gstAmount: 77,
      grandTotal: 1076,
      paidAmount: 500,
      balanceAmount: 576,
      items: { create: [mkItem(1, "Kids Shirt"), mkItem(2, "Kids Shirt"), mkItem(3, "Kids Shirt"), mkItem(4, "Kids Shirt"), mkItem(5, "Shirt"), mkItem(6, "Shirt"), mkItem(7, "Shirt"), mkItem(8, "Shirt"), mkItem(9, "Shirt")] },
    },
  });

  const longChallan = await prisma.deliveryChallan.create({
    data: {
      firmId,
      challanNumber: `${challanNumber}-L`,
      orderId: order.id,
      branchId: branch.id,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      items: {
        create: Array.from({ length: 70 }, (_, i) =>
          mkItem(100 + i, `Embroidered Bridal Lehenga With Heavy Zari Work And Dupatta Item ${i + 1}`),
        ),
      },
    },
  });

  return {
    firmId,
    name: opts.name,
    branchId: branch.id,
    branchName: opts.branch,
    customerId: customer.id,
    orderId: order.id,
    invoiceId: invoice.id,
    invoiceNumber,
    challanId: challan.id,
    challanNumber,
    longChallanId: longChallan.id,
  };
}

function text(buf: Buffer): string {
  const f = path.join(tmp, `${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(f, buf);
  return execFileSync("pdftotext", ["-layout", f, "-"]).toString();
}
function info(buf: Buffer): { pages: number; size: string } {
  const f = path.join(tmp, `${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(f, buf);
  const out = execFileSync("pdfinfo", [f]).toString();
  return { pages: Number(/Pages:\s+(\d+)/.exec(out)![1]), size: /Page size:\s+(.*)/.exec(out)![1] };
}
function imageHashes(buf: Buffer): string[] {
  const f = path.join(tmp, `${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(f, buf);
  const prefix = path.join(tmp, Math.random().toString(36).slice(2));
  execFileSync("pdfimages", ["-all", f, prefix]);
  return fs
    .readdirSync(tmp)
    .filter((n) => n.startsWith(path.basename(prefix)))
    .map((n) => fs.readFileSync(path.join(tmp, n)).toString("base64").slice(0, 400));
}

before(async () => {
  A = await makeFirm("a", {
    name: "Alpha Wash Co",
    branch: "Alpha Marnamikatte",
    gstin: "",
    phone: "7022818899",
    logo: solidPng(200, 30, 30),
    accent: "#068708",
    challanPrefix: "AM",
    invoicePrefix: "ALP",
    address: "Westgate Eternia, Marnamikatte Circle",
  });
  B = await makeFirm("b", {
    name: "Beta Dry Clean Ltd",
    branch: "Beta Kankanady",
    gstin: "29ABCDE1234F1Z5",
    phone: "9000000002",
    logo: solidPng(30, 30, 200),
    accent: "#1a3c8c",
    challanPrefix: "BK",
    invoicePrefix: "BET",
    address: "Kankanady Main Road",
  });
});

after(async () => {
  for (const firmId of created.firms) {
    await prisma.deliveryChallan.deleteMany({ where: { firmId } });
    await prisma.invoice.deleteMany({ where: { firmId } });
    await prisma.orderItem.deleteMany({ where: { order: { firmId } } });
    await prisma.order.deleteMany({ where: { firmId } });
    await prisma.customer.deleteMany({ where: { firmId } });
    await prisma.service.deleteMany({ where: { firmId } });
    await prisma.garmentType.deleteMany({ where: { firmId } });
    await prisma.setting.deleteMany({ where: { firmId } });
    await prisma.branch.deleteMany({ where: { firmId } });
    await prisma.firm.delete({ where: { id: firmId } });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  await prisma.$disconnect();
});

test("challan: each firm prints only its own branding, in the reference structure", async () => {
  const a = await generateChallanPDF(A.challanId, { firmId: A.firmId });
  const b = await generateChallanPDF(B.challanId, { firmId: B.firmId });
  const ta = text(a.buffer);
  const tb = text(b.buffer);

  assert.match(ta, /Alpha Wash Co - Alpha Marnamikatte/);
  assert.match(ta, /Westgate Eternia, Marnamikatte Circle/);
  assert.match(ta, /Phone no\.: 7022818899/);
  assert.match(tb, /Beta Dry Clean Ltd - Beta Kankanady/);
  assert.match(tb, /Phone no\.: 9000000002/);
  assert.doesNotMatch(ta, /Beta/);
  assert.doesNotMatch(tb, /Alpha|Aurclean/i);

  // Reference structure & wording
  for (const t of [ta, tb]) {
    assert.match(t, /Delivery Challan\s*\n/);
    assert.match(t, /Delivery Challan for/);
    assert.match(t, /Transportation Details/);
    assert.match(t, /Challan Details/);
    assert.match(t, /Contact No\.: 7022897801/);
    assert.match(t, /Pickup\/Delivery:/);
    assert.match(t, /Delivery Date: 23-10-2026/);
    assert.match(t, /Date: 21-10-2026/);
    assert.match(t, /Time: 01:49 PM/);
    assert.match(t, /#\s+Item name\s+Quantity\s+Unit/);
    assert.match(t, /Authorized Signatory/);
    assert.match(t, /Terms And Conditions/);
  }
  assert.match(ta, new RegExp(`Challan No\\. ${A.challanNumber}`));
  assert.match(tb, new RegExp(`Challan No\\. ${B.challanNumber}`));
  assert.match(ta, /For: Alpha Wash Co - Alpha Marnamikatte/);
  assert.match(ta, /Alpha Wash Co terms clause one/);
  assert.match(tb, /Beta Dry Clean Ltd terms clause one/);
  assert.doesNotMatch(ta, /Beta Dry/);

  // Items are grouped per distinct item, with correct quantities / total
  assert.match(ta, /1\s+Kids Shirt Steam Press\s+4\s+Pcs/);
  assert.match(ta, /2\s+Shirt Steam Press\s+5\s+Pcs/);
  assert.match(ta, /Total\s+9\s*\n/);

  // Customer address (delivery address) present
  assert.match(ta, /Address: 12 Main Road,/);
  assert.match(ta, /Jeppu/);
});

test("challan is non-financial: no rates, tax, totals, payments or balances", async () => {
  const { buffer } = await generateChallanPDF(B.challanId, { firmId: B.firmId });
  const t = text(buffer);
  assert.doesNotMatch(t, /₹|Rs\.?|INR|Rate|Amount|Sub ?total|Discount|GST(?!IN)|Tax|Received|Balance|Payment|Paid|1076|999|576|500\.00/i);
});

test("challan: distinct per-firm logo images and A4 page", async () => {
  const a = await generateChallanPDF(A.challanId, { firmId: A.firmId });
  const b = await generateChallanPDF(B.challanId, { firmId: B.firmId });
  const ia = imageHashes(a.buffer);
  const ib = imageHashes(b.buffer);
  assert.equal(ia.length, 1);
  assert.equal(ib.length, 1);
  assert.notEqual(ia[0], ib[0], "firm A and firm B must embed different logos");
  const meta = info(a.buffer);
  assert.equal(meta.pages, 1);
  assert.match(meta.size, /595\.\d+ x 841\.\d+ pts \(A4\)/);
});

test("challan: no logo configured → no logo (never another firm's)", async () => {
  await prisma.setting.update({ where: { firmId_key: { firmId: A.firmId, key: "company_logo" } }, data: { value: "" } });
  const { buffer } = await generateChallanPDF(A.challanId, { firmId: A.firmId });
  assert.equal(imageHashes(buffer).length, 0);
  await prisma.setting.update({ where: { firmId_key: { firmId: A.firmId, key: "company_logo" } }, data: { value: solidPng(200, 30, 30) } });
});

test("long challan paginates: repeated header, no blank or footer-only pages, total stays with items", async () => {
  const { buffer } = await generateChallanPDF(A.longChallanId, { firmId: A.firmId });
  const meta = info(buffer);
  assert.ok(meta.pages >= 2, "70 long items must span multiple pages");
  const f = path.join(tmp, "long.pdf");
  fs.writeFileSync(f, buffer);
  for (let p = 1; p <= meta.pages; p++) {
    const pageText = execFileSync("pdftotext", ["-layout", "-f", String(p), "-l", String(p), f, "-"]).toString();
    assert.match(pageText, /Item name\s+Quantity\s+Unit/, `page ${p} repeats the table header`);
    const itemRows = (pageText.match(/Embroidered Bridal Lehenga/g) ?? []).length;
    assert.ok(itemRows > 0, `page ${p} must carry item rows (no blank / footer-only page)`);
    assert.match(pageText, new RegExp(`Page ${p} of ${meta.pages}`));
  }
  const all = text(buffer);
  for (let i = 1; i <= 70; i++) assert.match(all, new RegExp(`Item ${i}\\b`));
  assert.match(all, /Total\s+70/);
  // Total row is not alone on the last page
  const last = execFileSync("pdftotext", ["-layout", "-f", String(meta.pages), "-l", String(meta.pages), f, "-"]).toString();
  assert.match(last, /Lehenga/);
});

test("invoice: Bill of Supply (no GSTIN) vs Tax Invoice (GST firm) with each firm's data", async () => {
  const a = await generateInvoicePDF(A.invoiceId, { firmId: A.firmId });
  const b = await generateInvoicePDF(B.invoiceId, { firmId: B.firmId });
  const ta = text(a.buffer);
  const tb = text(b.buffer);

  assert.match(ta, /Bill of Supply/);
  assert.doesNotMatch(ta, /GSTIN|CGST|SGST|Tax Invoice/);
  assert.match(tb, /Tax Invoice/);
  assert.match(tb, /GSTIN: 29ABCDE1234F1Z5/);
  assert.match(tb, /CGST \(9%\)/);
  assert.match(tb, /SGST \(9%\)/);

  assert.match(ta, new RegExp(`Invoice No\\. ${A.invoiceNumber}`));
  assert.match(tb, new RegExp(`Invoice No\\. ${B.invoiceNumber}`));
  assert.match(A.invoiceNumber, /^ALP\d{6}$/);
  assert.match(B.invoiceNumber, /^BET\d{6}$/);
  assert.match(A.challanNumber, /^AM-\d{4}-\d{6}$/);
  assert.match(B.challanNumber, /^BK-\d{4}-\d{6}$/);

  assert.doesNotMatch(ta, /Beta/);
  assert.doesNotMatch(tb, /Alpha/);

  // Saved figures are printed untouched
  assert.match(ta, /₹225\.50/);
  assert.match(ta, /Received\s+₹100\.00/);
  assert.match(ta, /Balance\s+₹125\.50/);
  assert.match(ta, /Two Hundred Twenty[- ]Five Rupees and Fifty Paise/i);
  assert.match(tb, /₹266\.09/);
  assert.match(tb, /Balance\s+₹166\.09/);
  assert.match(ta, /Kids Shirt Steam Press\s+4/);
  assert.match(ta, /Shirt Steam Press\s+5/);
  assert.match(ta, /₹25\.10/);
  assert.match(ta, /Total\s+9/);
  assert.equal(info(a.buffer).pages, 1);
  assert.notEqual(imageHashes(a.buffer)[0], imageHashes(b.buffer)[0]);
});

test("firm isolation: ids from another firm are rejected, even if guessed", async () => {
  await assert.rejects(generateChallanPDF(B.challanId, { firmId: A.firmId }), DocumentAccessError);
  await assert.rejects(generateInvoicePDF(B.invoiceId, { firmId: A.firmId }), DocumentAccessError);
  await assert.rejects(generateChallanPDF("does-not-exist", { firmId: A.firmId }), DocumentAccessError);
});

test("joined records from a different firm are rejected", async () => {
  const rogue = await prisma.deliveryChallan.create({
    data: {
      firmId: A.firmId,
      challanNumber: `ROGUE-${RUN}`,
      orderId: B.orderId, // firm B's order under firm A's challan
      branchId: A.branchId,
      customerName: "X",
      customerPhone: "1",
    },
  });
  await assert.rejects(generateChallanPDF(rogue.id, { firmId: A.firmId }), DocumentAccessError);
  await prisma.deliveryChallan.delete({ where: { id: rogue.id } });
});

test("document numbers are unique across firms", async () => {
  assert.notEqual(A.invoiceNumber, B.invoiceNumber);
  assert.notEqual(A.challanNumber, B.challanNumber);
  const nums = await Promise.all(Array.from({ length: 10 }, () => nextChallanNumber(prisma, A.firmId)));
  assert.equal(new Set(nums).size, 10);
});

test("existing records are untouched by PDF generation", async () => {
  const before = await prisma.invoice.findUnique({ where: { id: B.invoiceId } });
  await generateInvoicePDF(B.invoiceId, { firmId: B.firmId });
  const after = await prisma.invoice.findUnique({ where: { id: B.invoiceId } });
  assert.deepEqual(after, before);
});

test("invoice: 12 items stay on one page; 60 items paginate with repeated header and totals kept together", async () => {
  const mkInvoice = async (fx: Fixture, count: number) => {
    const gt = await prisma.garmentType.findFirstOrThrow({ where: { firmId: fx.firmId, name: "Shirt" } });
    const svc = await prisma.service.findFirstOrThrow({ where: { firmId: fx.firmId } });
    const order = await prisma.order.create({
      data: {
        firmId: fx.firmId,
        orderNumber: `ORDX-${count}-${RUN}-${fx.firmId.slice(-4)}`,
        branchId: fx.branchId,
        customerId: fx.customerId,
        customerName: "Cust",
        customerPhone: "7022897801",
        expectedDeliveryAt: new Date(),
        items: {
          create: Array.from({ length: count }, (_, i) => ({
            firmId: fx.firmId,
            serviceId: svc.id,
            garmentTypeId: gt.id,
            quantity: 1,
            unitPrice: 10 + i,
            lineTotal: 10 + i,
          })),
        },
      },
    });
    return prisma.invoice.create({
      data: {
        firmId: fx.firmId,
        invoiceNumber: `${await nextInvoiceNumber(prisma, fx.firmId)}`,
        branchId: fx.branchId,
        orderId: order.id,
        customerId: fx.customerId,
        billToName: "Cust",
        subtotal: 1000,
        totalAmount: 1000,
        amountDue: 1000,
      },
    });
  };

  const small = await mkInvoice(A, 12);
  const big = await mkInvoice(A, 60);
  assert.equal(info((await generateInvoicePDF(small.id, { firmId: A.firmId })).buffer).pages, 1);

  const { buffer } = await generateInvoicePDF(big.id, { firmId: A.firmId });
  const meta = info(buffer);
  assert.ok(meta.pages >= 2);
  const f = path.join(tmp, "bigInvoice.pdf");
  fs.writeFileSync(f, buffer);
  for (let p = 1; p <= meta.pages; p++) {
    const t = execFileSync("pdftotext", ["-layout", "-f", String(p), "-l", String(p), f, "-"]).toString();
    assert.match(t, /Item name\s+Quantity\s+Unit\s+Final Rate\s+Amount/, `page ${p} repeats the header`);
    assert.match(t, /Shirt Steam Press/, `page ${p} carries item rows`);
  }
  const last = execFileSync("pdftotext", ["-layout", "-f", String(meta.pages), "-l", String(meta.pages), f, "-"]).toString();
  assert.match(last, /Invoice Amount In Words/);
  assert.match(last, /Authorized Signatory/);
});
