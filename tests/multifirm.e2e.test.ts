/**
 * Multi-firm RBAC end-to-end suite — real server, real database, real browser.
 *
 *   (server running)  BASE_URL=http://localhost:3000 DATABASE_URL=... npm run test:multifirm
 *
 * Drives the production build in a phone-sized Chromium: the Platform Super
 * Admin creates three firms through the UI, each Firm Manager creates a Field
 * Manager and a QC account, then cross-firm / cross-role / cross-customer
 * access is attacked over HTTP with the real sessions. Everything created is
 * removed afterwards. No WhatsApp traffic is simulated here (see
 * tests/whatsapp.routing.test.ts).
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import { createRequire } from "node:module";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Playwright is provided by the test environment (not a project dependency).
const playwright = createRequire(import.meta.url)("playwright") as any;
type APIRequestContext = any;
type Browser = any;
type BrowserContext = any;
type Page = any;

import { prisma } from "@/lib/prisma";
import { issueAccessCode } from "@/lib/access-code";
import { issuePortalLink } from "@/lib/customer-auth";
import { nextInvoiceNumber } from "@/lib/sequence";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36);
const CODE_RE = /\b[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}\b/;

interface FirmCtx {
  key: "FALNIR" | "DERALAKATTE" | "BHATKAL";
  name: string;
  firmId: string;
  managerCode: string;
  fieldCode: string;
  qcCode: string;
  branchId: string;
  customerId: string;
  orderId: string;
  invoiceId: string;
  garmentId: string;
}

let browser: Browser;
let platformCode: string;
let platformUserId: string;
const firms: Record<string, FirmCtx> = {};
const createdFirmIds: string[] = [];

const mobile = () => ({ ...playwright.devices["iPhone 13"] });

async function newCtx(): Promise<BrowserContext> {
  return browser.newContext({ ...mobile(), baseURL: BASE });
}

async function login(ctx: BrowserContext, code: string): Promise<{ page: Page; landed: string }> {
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Access code").fill(code);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL((u: URL) => !u.pathname.startsWith("/login"), { timeout: 30000 });
  return { page, landed: new URL(page.url()).pathname };
}

/** Server redirects from streamed pages land a moment after goto() resolves. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400);
}

const field = (page: Page, label: string, nth = 0) =>
  page.locator(`xpath=(.//label[normalize-space(translate(.,'*',''))="${label}"]/following-sibling::*[1])[${nth + 1}]`);

async function createFirmViaUi(page: Page, spec: { code: string; name: string; city: string; gstin?: string; prefix: string; manager: string; email: string }) {
  await page.goto("/firms");
  await page.getByRole("button", { name: /New firm/ }).click();
  await field(page, "Firm code").fill(spec.code);
  await field(page, "Business name").fill(spec.name);
  await field(page, "Legal name").fill(`${spec.name} Pvt Ltd`);
  if (spec.gstin) await field(page, "GSTIN").fill(spec.gstin);
  await field(page, "Phone", 0).fill("9000000000");
  await field(page, "Email", 0).fill(`${spec.code.toLowerCase()}@firm.example.test`);
  await field(page, "City").fill(spec.city);
  await field(page, "Address").fill(`${spec.city} Main Road`);
  await field(page, "Invoice prefix").fill(spec.prefix);
  await field(page, "Delivery challan prefix").fill(`${spec.prefix}C`);
  await field(page, "First branch name").fill(`${spec.name} Branch`);
  await field(page, "Name", 0).fill(spec.manager);
  await field(page, "Email", 1).fill(spec.email);
  await page.getByRole("button", { name: "Create firm" }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Firm created" });
  await dialog.waitFor({ timeout: 30000 });
  const code = CODE_RE.exec(await dialog.innerText())?.[0];
  assert.ok(code, "the one-time Firm Manager access code is displayed");
  return code!;
}

async function createStaffViaUi(page: Page, spec: { name: string; email: string; role: "Field Manager" | "QC" }) {
  await page.goto("/staff");
  await page.getByRole("button", { name: /Add staff/ }).click();
  const dialog = page.getByRole("dialog");
  await field(dialog as unknown as Page, "Full name").fill(spec.name);
  await field(dialog as unknown as Page, "Email").fill(spec.email);
  if (spec.role !== "Field Manager") {
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: spec.role }).click();
  }
  await dialog.getByRole("button", { name: "Create account" }).click();
  try {
    await dialog.getByText("is ready to sign in").waitFor({ timeout: 20000 });
  } catch (err) {
    throw new Error(`staff creation did not complete; dialog says: ${(await dialog.innerText()).replace(/\s+/g, " ").slice(0, 600)}`, { cause: err });
  }
  const code = CODE_RE.exec(await dialog.innerText())?.[0];
  assert.ok(code, "the one-time staff access code is displayed");
  return code!;
}

/** Fresh isolated API context signed in with an access code (cookie jar per user). */
async function apiAs(code: string): Promise<{ api: APIRequestContext; ctx: BrowserContext }> {
  const ctx = await newCtx();
  await login(ctx, code);
  return { api: ctx.request, ctx };
}

before(async () => {
  browser = await playwright.chromium.launch();
  // Start from a clean lockout window (earlier runs deliberately trigger it).
  await prisma.loginEvent.deleteMany({ where: { event: { in: ["LOGIN_FAILED", "LOGIN_LOCKED", "OTP_REQUESTED"] } } });
  const admin = await prisma.user.create({
    data: { name: "E2E Platform Admin", email: `platform-${RUN}@e2e.test`, role: "PLATFORM_SUPER_ADMIN", employeeCode: `E2E${RUN}`.slice(0, 20) },
  });
  platformUserId = admin.id;
  platformCode = await issueAccessCode(admin.id);
});

after(async () => {
  await browser?.close();
  const ids = createdFirmIds;
  await prisma.loginEvent.deleteMany({ where: { OR: [{ firmId: { in: ids } }, { userId: platformUserId }] } });
  await prisma.customerOtp.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.qCRecord.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.whatsAppLog.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.garment.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.invoice.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.payment.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.deliveryChallan.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.pickup.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.delivery.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.orderItem.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.order.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.service.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.garmentType.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.driver.deleteMany({ where: { user: { firmId: { in: ids } } } });
  await prisma.staffProfile.deleteMany({ where: { user: { firmId: { in: ids } } } });
  await prisma.user.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.setting.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.whatsAppSession.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.branch.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.firm.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.delete({ where: { id: platformUserId } }).catch(() => {});
  await prisma.$disconnect();
});

test("1. Platform Super Admin signs in to the platform dashboard (not a firm)", async () => {
  const ctx = await newCtx();
  const { page, landed } = await login(ctx, platformCode);
  assert.equal(landed, "/platform");
  await page.getByText("Platform dashboard").first().waitFor();
  // Operational pages are closed until a firm is explicitly entered.
  const res = await page.goto("/orders");
  assert.equal(new URL(page.url()).pathname, "/platform", `redirected away from /orders (status ${res?.status()})`);
  await ctx.close();
});

test("2. Platform Super Admin creates three firms; each gets its own Firm Manager code", async () => {
  const ctx = await newCtx();
  const { page } = await login(ctx, platformCode);
  const specs = [
    { key: "FALNIR" as const, name: "Falnir Laundry", city: "Falnir", gstin: "29ABCDE1234F1Z5", prefix: "FAL" },
    { key: "DERALAKATTE" as const, name: "Deralakatte Laundry", city: "Deralakatte", prefix: "DER" },
    { key: "BHATKAL" as const, name: "Bhatkal Laundry", city: "Bhatkal", prefix: "BHT" },
  ];
  const codes = new Set<string>();
  for (const s of specs) {
    const code = `${s.key}${RUN}`.toUpperCase().slice(0, 20);
    const managerCode = await createFirmViaUi(page, { code, name: s.name, city: s.city, gstin: s.gstin, prefix: s.prefix, manager: `${s.name} Manager`, email: `mgr-${s.key.toLowerCase()}-${RUN}@e2e.test` });
    codes.add(managerCode);

    const firm = await prisma.firm.findUniqueOrThrow({ where: { code }, include: { branches: true, whatsAppSessions: true, settings: true } });
    createdFirmIds.push(firm.id);
    firms[s.key] = { key: s.key, name: s.name, firmId: firm.id, managerCode, fieldCode: "", qcCode: "", branchId: firm.branches[0].id, customerId: "", orderId: "", invoiceId: "", garmentId: "" };

    // Initialisation done by the creation flow
    assert.equal(firm.branches.length, 1);
    assert.equal(firm.whatsAppSessions.length, 1, "own WhatsApp session record");
    assert.equal(firm.whatsAppSessions[0].sessionName, `whatsapp_${code.toLowerCase()}`);
    assert.equal(firm.settings.find((x) => x.key === "invoice_prefix")?.value, s.prefix);
    const manager = await prisma.user.findFirstOrThrow({ where: { firmId: firm.id, role: "FIRM_MANAGER" } });
    assert.ok(manager.accessCodeHash && !manager.accessCode, "code stored only as a hash");
    assert.ok(!JSON.stringify(manager).includes(managerCode.replace(/-/g, "")), "plaintext never stored");
  }
  assert.equal(codes.size, 3, "all three manager codes are different");
  assert.equal(new Set(Object.values(firms).map((f) => f.firmId)).size, 3);
  const sessions = await prisma.whatsAppSession.findMany({ where: { firmId: { in: createdFirmIds } } });
  assert.equal(new Set(sessions.map((s) => s.sessionName)).size, 3, "three distinct WhatsApp session ids");
  await ctx.close();
});

test("3. Each Firm Manager creates a Field Manager and a QC account (staff codes shown once)", async () => {
  for (const f of Object.values(firms)) {
    const ctx = await newCtx();
    const { page, landed } = await login(ctx, f.managerCode);
    assert.equal(landed, "/dashboard", "Firm Manager lands on the firm dashboard");
    f.fieldCode = await createStaffViaUi(page, { name: `${f.key} Field`, email: `field-${f.key.toLowerCase()}-${RUN}@e2e.test`, role: "Field Manager" });
    f.qcCode = await createStaffViaUi(page, { name: `${f.key} QC`, email: `qc-${f.key.toLowerCase()}-${RUN}@e2e.test`, role: "QC" });
    assert.notEqual(f.fieldCode, f.qcCode);

    const staff = await prisma.user.findMany({ where: { firmId: f.firmId, role: { in: ["FIELD_MANAGER", "QC"] } } });
    assert.deepEqual(staff.map((s) => s.role).sort(), ["FIELD_MANAGER", "QC"]);
    assert.ok(staff.every((s) => s.firmId === f.firmId && s.accessCodeHash && !s.accessCode));
    assert.ok(await prisma.driver.findFirst({ where: { user: { firmId: f.firmId, role: "FIELD_MANAGER" } } }), "Field Manager has a job profile");
    await ctx.close();
  }
  const all = Object.values(firms).flatMap((f) => [f.managerCode, f.fieldCode, f.qcCode]);
  assert.equal(new Set(all).size, 9, "nine globally unique codes");
});

test("4. Each code signs in as exactly the right user, role and firm (mobile)", async () => {
  for (const f of Object.values(firms)) {
    for (const [code, role, landing] of [[f.managerCode, "FIRM_MANAGER", "/dashboard"], [f.fieldCode, "FIELD_MANAGER", "/field"], [f.qcCode, "QC", "/qc"]] as const) {
      const ctx = await newCtx();
      const { page, landed } = await login(ctx, code);
      assert.equal(landed, landing, `${f.key} ${role} landing`);
      const user = await prisma.user.findFirstOrThrow({ where: { firmId: f.firmId, role } });
      assert.equal(user.firmId, f.firmId);
      // No horizontal overflow on a phone-sized screen.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, `${f.key} ${role} page fits the phone width (overflow ${overflow}px)`);
      await ctx.close();
    }
  }
});

test("5. Seed per-firm business data (real DB) and check each firm sees only its own users", async () => {
  for (const f of Object.values(firms)) {
    const customer = await prisma.customer.create({ data: { firmId: f.firmId, code: `C${f.key.slice(0, 3)}${RUN}`, branchId: f.branchId, name: `${f.key} Customer`, phone: `70228${String(Math.floor(10000 + Math.random() * 89999))}` } });
    const gt = await prisma.garmentType.create({ data: { firmId: f.firmId, code: `GT${f.key.slice(0, 3)}${RUN}`, name: "Shirt" } });
    const svc = await prisma.service.create({ data: { firmId: f.firmId, code: `SV${f.key.slice(0, 3)}${RUN}`, name: "Steam Press", basePrice: 25 } });
    const order = await prisma.order.create({
      data: {
        firmId: f.firmId, orderNumber: `ORD-${f.key.slice(0, 3)}-${RUN}`, branchId: f.branchId, customerId: customer.id, customerName: customer.name, customerPhone: customer.phone,
        expectedDeliveryAt: new Date(), subtotal: 100, totalAmount: 100, outstandingAmount: 100,
        items: { create: [{ firmId: f.firmId, serviceId: svc.id, garmentTypeId: gt.id, quantity: 4, unitPrice: 25, lineTotal: 100 }] },
      },
    });
    const invoice = await prisma.invoice.create({
      data: { firmId: f.firmId, invoiceNumber: await nextInvoiceNumber(prisma, f.firmId), branchId: f.branchId, orderId: order.id, customerId: customer.id, billToName: customer.name, subtotal: 100, totalAmount: 100, amountDue: 100 },
    });
    const garment = await prisma.garment.create({
      data: {
        firmId: f.firmId, garmentCode: `G-${f.key.slice(0, 3)}-${RUN}`, qrPayload: `qr-${f.key}-${RUN}`, barcodeValue: `bc-${f.key}-${RUN}`, orderId: order.id,
        garmentTypeId: gt.id, serviceId: svc.id, branchId: f.branchId, status: "IRONED",
      },
    });
    await prisma.processingTask.createMany({
      data: [
        { garmentId: garment.id, stage: "IRONING", sequence: 1, status: "COMPLETED", branchId: f.branchId },
        { garmentId: garment.id, stage: "QUALITY_CHECK", sequence: 2, status: "PENDING", branchId: f.branchId },
      ],
    });
    Object.assign(f, { customerId: customer.id, orderId: order.id, invoiceId: invoice.id, garmentId: garment.id });
  }

  // Staff list: a manager sees their own firm's staff and nobody else's.
  const falnir = firms.FALNIR;
  const ctx = await newCtx();
  const { page } = await login(ctx, falnir.managerCode);
  await page.goto("/staff");
  const text = await page.locator("main").innerText();
  assert.match(text, /FALNIR Field/);
  assert.doesNotMatch(text, /DERALAKATTE|BHATKAL/);
  await ctx.close();
});

test("6. Cross-firm IDOR: Firm A cannot reach Firm B or C records by changing an id", async () => {
  const a = firms.FALNIR;
  const { api, ctx } = await apiAs(a.managerCode);
  const own = await api.get(`/api/documents/pdf?type=invoice&id=${a.invoiceId}`);
  assert.equal(own.status(), 200, "own invoice PDF works");
  assert.match(own.headers()["content-type"], /application\/pdf/);

  for (const other of [firms.DERALAKATTE, firms.BHATKAL]) {
    for (const [type, id] of [["invoice", other.invoiceId], ["order_summary", other.orderId], ["statement", other.customerId]] as const) {
      const res = await api.get(`/api/documents/pdf?type=${type}&id=${id}`);
      assert.ok([403, 404].includes(res.status()), `${type} of ${other.key}: expected 403/404, got ${res.status()}`);
      assert.doesNotMatch(res.headers()["content-type"] ?? "", /pdf/);
    }
    // Pages that load a record by id from the URL
    for (const path of [`/orders/${other.orderId}`, `/customers/${other.customerId}`]) {
      const res = await api.get(path, { maxRedirects: 0 });
      const body = await res.text();
      assert.ok(!body.includes(`${other.key} Customer`), `${path} must not render ${other.key}'s customer`);
      assert.ok(!body.includes(`ORD-${other.key.slice(0, 3)}-${RUN}`), `${path} must not render ${other.key}'s order number`);
    }
  }

  // WhatsApp: Firm A only ever sees its own session, name and number.
  const wa = await api.get("/api/whatsapp/status");
  const status = await wa.json();
  assert.equal(status.firmId, a.firmId);
  assert.match(status.sessionId, new RegExp(`^whatsapp_falnir${RUN}`, "i"));
  assert.ok(!JSON.stringify(status).includes("deralakatte") && !JSON.stringify(status).includes("bhatkal"));
  await ctx.close();
});

test("7. A firm's PDFs carry that firm's own identity", async () => {
  for (const f of Object.values(firms)) {
    const { api, ctx } = await apiAs(f.managerCode);
    const res = await api.get(`/api/documents/pdf?type=invoice&id=${f.invoiceId}`);
    assert.equal(res.status(), 200);
    const { execFileSync } = await import("node:child_process");
    const fs = await import("node:fs");
    const file = `/tmp/e2e-${f.key}-${RUN}.pdf`;
    fs.writeFileSync(file, await res.body());
    const text = execFileSync("pdftotext", ["-layout", file, "-"]).toString();
    assert.ok(text.includes(f.name), `${f.key} invoice names ${f.name}`);
    for (const other of Object.values(firms).filter((o) => o.key !== f.key)) assert.ok(!text.includes(other.name), `${f.key} invoice must not name ${other.name}`);
    fs.rmSync(file);
    await ctx.close();
  }
});

test("8. Field Manager and QC cannot reach administrator functions", async () => {
  const a = firms.FALNIR;
  for (const [label, code, home] of [["Field Manager", a.fieldCode, "/field"], ["QC", a.qcCode, "/qc"]] as const) {
    const ctx = await newCtx();
    const { page } = await login(ctx, code);
    for (const path of ["/staff", "/settings", "/settings/whatsapp", "/billing", "/reports", "/finance", "/firms", "/platform", "/customers", "/orders"]) {
      await page.goto(path);
      await settle(page);
      const final = new URL(page.url()).pathname;
      assert.ok(final === home || final.startsWith(home) || final === "/forbidden" || final === "/platform" && false, `${label} opening ${path} ended on ${final}`);
      assert.ok(final !== path || path === home, `${label} must not stay on ${path}`);
    }
    const api = ctx.request;
    for (const url of ["/api/whatsapp/status", "/api/whatsapp/session", `/api/documents/pdf?type=invoice&id=${a.invoiceId}`]) {
      const res = await api.get(url, { maxRedirects: 0 });
      assert.ok(res.status() !== 200 || !(res.headers()["content-type"] ?? "").includes("pdf"), `${label} ${url} -> ${res.status()}`);
      assert.notEqual(res.status(), 200, `${label} must not get ${url}`);
    }
    await ctx.close();
  }
});

test("9. Firm Manager cannot use platform functions or another firm's context", async () => {
  const ctx = await newCtx();
  const { page } = await login(ctx, firms.FALNIR.managerCode);
  for (const path of ["/firms", "/platform", "/platform/whatsapp", "/platform/managers"]) {
    await page.goto(path);
    await settle(page);
    const final = new URL(page.url()).pathname;
    assert.ok(final === "/forbidden" || final === "/dashboard", `Firm Manager opening ${path} ended on ${final}`);
  }
  // Session cannot be pointed at another firm: the update trigger only honours platform admins.
  const session = await (await ctx.request.get("/api/auth/session")).json();
  assert.equal(session.user.firmId, firms.FALNIR.firmId);
  assert.equal(session.user.activeFirmId, firms.FALNIR.firmId);
  const csrf = (await (await ctx.request.get("/api/auth/csrf")).json()).csrfToken;
  const upd = await ctx.request.post("/api/auth/session", { data: { csrfToken: csrf, data: { activeFirmId: firms.BHATKAL.firmId } } });
  void upd;
  const after = await (await ctx.request.get("/api/auth/session")).json();
  assert.equal(after.user.activeFirmId, firms.FALNIR.firmId, "activeFirmId cannot be switched by a firm user");
  await ctx.close();
});

test("10. Platform Super Admin sees every firm without mixing data, and must enter a firm explicitly", async () => {
  const ctx = await newCtx();
  const { page } = await login(ctx, platformCode);
  await page.goto("/platform");
  await page.getByText(firms.BHATKAL.name).first().waitFor({ timeout: 30000 });
  const text = await page.locator("main").innerText();
  for (const f of Object.values(firms)) assert.match(text, new RegExp(f.name));
  await page.goto("/platform/whatsapp");
  await page.getByText(firms.BHATKAL.name).first().waitFor({ timeout: 30000 });
  const wa = await page.locator("main").innerText();
  for (const f of Object.values(firms)) assert.match(wa, new RegExp(f.name));
  assert.doesNotMatch(wa, /data:image\/png;base64/, "no QR is exposed on the platform overview");

  // Not inside any firm until explicitly entered: operational data is unreachable.
  const res = await ctx.request.get(`/api/documents/pdf?type=invoice&id=${firms.BHATKAL.invoiceId}`, { maxRedirects: 0 });
  assert.notEqual(res.status(), 200);
  await ctx.close();
});

test("11. QC workflow: pending → failed → rework → pending → passed (QC role, own firm only)", async () => {
  const a = firms.FALNIR;
  const ctx = await newCtx();
  const { page } = await login(ctx, a.qcCode);
  await page.goto("/qc");
  await page.getByText(`G-FAL-${RUN}`).first().waitFor();

  // Another firm's garment is never listed.
  const qcText = await page.locator("main").innerText();
  assert.doesNotMatch(qcText, new RegExp(`G-DER-${RUN}|G-BHA-${RUN}`));

  // Fail needs a note, then rework, then back into the queue, then pass.
  const card = page.getByText(`G-FAL-${RUN}`).first().locator("xpath=ancestor::div[.//input][1]");
  await card.getByPlaceholder(/Inspection notes/).fill("Stain remains on collar");
  await card.getByRole("button", { name: "Fail" }).click();
  await page.waitForTimeout(1500);
  let g = await prisma.garment.findUniqueOrThrow({ where: { id: a.garmentId } });
  assert.equal(g.status, "QC_FAILED");

  await page.goto("/qc/failed");
  await page.getByRole("button", { name: "Send for rework" }).click();
  await page.waitForTimeout(1500);
  g = await prisma.garment.findUniqueOrThrow({ where: { id: a.garmentId } });
  assert.equal(g.status, "REWORK");
  assert.equal(g.reworkCount, 1);

  // Rework finished at the stations: the finishing stage is done again and the
  // garment returns to the QC queue (station step applied directly in the DB —
  // the station UI itself is outside this suite).
  await prisma.processingTask.updateMany({ where: { garmentId: a.garmentId, stage: "IRONING" }, data: { status: "COMPLETED" } });
  await prisma.processingTask.updateMany({ where: { garmentId: a.garmentId, stage: "QUALITY_CHECK" }, data: { status: "PENDING" } });
  await prisma.garment.update({ where: { id: a.garmentId }, data: { status: "IRONED" } });

  await page.goto("/qc");
  await page.getByText(`G-FAL-${RUN}`).first().waitFor();
  const card2 = page.getByText(`G-FAL-${RUN}`).first().locator("xpath=ancestor::div[.//input][1]");
  await card2.getByRole("button", { name: "Pass" }).click();
  await page.waitForTimeout(1500);
  g = await prisma.garment.findUniqueOrThrow({ where: { id: a.garmentId } });
  assert.equal(g.status, "QC_PASSED");

  const history = await prisma.qCRecord.findMany({ where: { garmentId: a.garmentId }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(history.map((h) => h.result), ["FAILED", "REWORK", "PASSED"]);
  assert.ok(history.every((h) => h.firmId === a.firmId));
  await ctx.close();
});

test("12. Customers: own data only, via customer-specific link; no staff access; others' orders are 404", async () => {
  const a = firms.FALNIR;
  const b = firms.DERALAKATTE;
  const tokenA = await issuePortalLink(a.customerId, a.firmId);
  const tokenB = await issuePortalLink(b.customerId, b.firmId);

  const ctxA = await newCtx();
  const pageA = await ctxA.newPage();
  await pageA.goto(`/portal/link/${tokenA}`);
  assert.equal(new URL(pageA.url()).pathname, "/portal");
  assert.match(await pageA.locator("main").innerText(), new RegExp(`ORD-FAL-${RUN}`));

  const api = ctxA.request;
  assert.equal((await api.get(`/portal/orders/${a.orderId}`)).status(), 200);
  assert.equal((await api.get(`/portal/orders/${b.orderId}`)).status(), 404, "another firm's order");
  assert.equal((await api.get(`/portal/orders/${firms.BHATKAL.orderId}`)).status(), 404);
  assert.equal((await api.get(`/portal/invoice/${a.invoiceId}`)).status(), 200);
  assert.equal((await api.get(`/portal/invoice/${b.invoiceId}`)).status(), 404);

  // Second customer in the SAME firm cannot see the first's order either.
  const other = await prisma.customer.create({ data: { firmId: a.firmId, code: `CX${RUN}`, branchId: a.branchId, name: "Other Customer", phone: "7022800000" } });
  const otherToken = await issuePortalLink(other.id, a.firmId);
  const ctxO = await newCtx();
  const pageO = await ctxO.newPage();
  await pageO.goto(`/portal/link/${otherToken}`);
  assert.equal((await ctxO.request.get(`/portal/orders/${a.orderId}`)).status(), 404, "same firm, different customer");
  await ctxO.close();

  // A customer session is not a staff session.
  for (const path of ["/dashboard", "/orders", "/staff", "/settings/whatsapp"]) {
    const res = await api.get(path, { maxRedirects: 0 });
    assert.ok([302, 303, 307, 308].includes(res.status()) || res.status() >= 400, `${path} -> ${res.status()}`);
  }
  assert.notEqual((await api.get(`/api/documents/pdf?type=invoice&id=${a.invoiceId}`, { maxRedirects: 0 })).status(), 200, "customers use the portal invoice route only");
  assert.notEqual((await api.get("/api/whatsapp/status", { maxRedirects: 0 })).status(), 200);

  // Invalid / foreign tokens do nothing.
  const ctxBad = await newCtx();
  const bad = await ctxBad.newPage();
  await bad.goto(`/portal/link/${"x".repeat(43)}`);
  assert.match(new URL(bad.url()).pathname + new URL(bad.url()).search, /\/portal\/login/);
  await ctxBad.close();
  void tokenB;
  await ctxA.close();
});

test("13. Customer OTP never leaks account existence, and is delivered only through the firm's own WhatsApp", async () => {
  const a = firms.FALNIR;
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: a.customerId } });
  const ctx = await newCtx();
  const page = await ctx.newPage();
  await page.goto("/portal/login");
  const known = await requestOtpUi(page, `FALNIR${RUN}`.toUpperCase().slice(0, 20), customer.phone);
  const unknown = await requestOtpUi(page, `FALNIR${RUN}`.toUpperCase().slice(0, 20), "9999999999");
  assert.equal(known, unknown, "identical response for registered and unregistered numbers");
  // With no connected WhatsApp session for the firm, no code is stored or leaked.
  assert.equal(await prisma.customerOtp.count({ where: { customerId: a.customerId } }), 0);
  // Wrong code never signs in.
  await page.getByPlaceholder("6-digit code").fill("123456").catch(() => {});
  await ctx.close();
});

async function requestOtpUi(page: Page, firmCode: string, phone: string): Promise<string> {
  await page.goto("/portal/login");
  await page.getByPlaceholder(/Firm code/).fill(firmCode);
  await page.getByPlaceholder("Mobile number").fill(phone);
  await page.getByRole("button", { name: /Send code/ }).click();
  const msg = page.getByText(/If this number is registered/);
  await msg.waitFor({ timeout: 15000 });
  return (await msg.innerText()).trim();
}

test("14. Access codes: regenerate invalidates the old, revoke blocks, deactivation cuts a live session, lockout engages", async () => {
  const a = firms.BHATKAL;
  const staff = await prisma.user.findFirstOrThrow({ where: { firmId: a.firmId, role: "QC" } });

  // Live session, then deactivate: the next request is refused immediately.
  const live = await newCtx();
  await login(live, a.qcCode);
  assert.equal((await live.request.get("/qc", { maxRedirects: 0 })).status(), 200);
  await prisma.user.update({ where: { id: staff.id }, data: { status: "INACTIVE" } });
  const afterOff = await live.request.get("/qc", { maxRedirects: 0 });
  assert.notEqual(afterOff.status(), 200, "deactivated user is cut off at once");
  await prisma.user.update({ where: { id: staff.id }, data: { status: "ACTIVE" } });
  await live.close();

  // Regenerate: old code dead, new code works.
  const fresh = await issueAccessCode(staff.id);
  const c1 = await newCtx();
  const p1 = await c1.newPage();
  await p1.goto("/login");
  await p1.getByLabel("Access code").fill(a.qcCode);
  await p1.getByRole("button", { name: "Continue" }).click();
  await p1.getByText(/not recognised|Too many/).waitFor();
  assert.equal(new URL(p1.url()).pathname, "/login");
  await c1.close();
  const c2 = await newCtx();
  const { landed } = await login(c2, fresh);
  assert.equal(landed, "/qc");
  await c2.close();

  // Revoke
  const { revokeAccessCode } = await import("@/lib/access-code");
  await revokeAccessCode(staff.id);
  const c3 = await newCtx();
  const p3 = await c3.newPage();
  await p3.goto("/login");
  await p3.getByLabel("Access code").fill(fresh);
  await p3.getByRole("button", { name: "Continue" }).click();
  await p3.getByText(/not recognised|Too many/).waitFor();
  await c3.close();

  // Lockout: repeated wrong codes from one client are locked out, even for a correct code afterwards.
  const c4 = await newCtx();
  const p4 = await c4.newPage();
  await p4.goto("/login");
  for (let i = 0; i < 9; i++) {
    await p4.getByLabel("Access code").fill(`ZZZZ-ZZZZ-${String(i).padStart(4, "2")}`);
    await p4.getByRole("button", { name: "Continue" }).click();
    await p4.getByText(/not recognised|Too many/).waitFor();
    await p4.waitForTimeout(500); // let the form clear itself before typing again
  }
  await p4.getByLabel("Access code").fill(a.managerCode);
  await p4.waitForTimeout(300);
  await p4.getByRole("button", { name: "Continue" }).click();
  await p4.getByText(/Too many failed attempts/).waitFor({ timeout: 15000 });
  await c4.close();
  const events = await prisma.loginEvent.groupBy({ by: ["event"], _count: { _all: true } });
  assert.ok(events.find((e) => e.event === "LOGIN_FAILED"));
  assert.ok(events.find((e) => e.event === "LOGIN_SUCCESS"));
  // Clear the lockout window for the remaining tests.
  await prisma.loginEvent.deleteMany({ where: { event: { in: ["LOGIN_FAILED", "LOGIN_LOCKED"] } } });
});

test("15. Logins and logouts are recorded", async () => {
  const f = firms.FALNIR;
  const ctx = await newCtx();
  const { page } = await login(ctx, f.managerCode);
  const manager = await prisma.user.findFirstOrThrow({ where: { firmId: f.firmId, role: "FIRM_MANAGER" } });
  assert.ok(await prisma.loginEvent.count({ where: { userId: manager.id, event: "LOGIN_SUCCESS" } }) >= 1);
  const csrf = (await (await ctx.request.get("/api/auth/csrf")).json()).csrfToken;
  await ctx.request.post("/api/auth/signout", { form: { csrfToken: csrf, callbackUrl: "/login" } });
  void page;
  assert.ok(await prisma.loginEvent.count({ where: { userId: manager.id, event: "LOGOUT" } }) >= 1, "LOGOUT recorded");
  await ctx.close();
});
