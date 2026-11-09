/**
 * Per-firm WhatsApp isolation tests.
 *
 *   DATABASE_URL=... AUTH_SECRET=... OPENWA_API_KEY=... npm run test:whatsapp
 *
 * Part A runs against the REAL OpenWA gateway process (scripts/openwa-server.mjs,
 * started by this test) — sessions, status and logout are the gateway's own.
 * It cannot pair a phone: the sandbox has no route to WhatsApp's servers, so
 * every session honestly reports "not connected".
 *
 * Part B uses a PROTOCOL STUB of the gateway's HTTP API (clearly a test double,
 * not WhatsApp) purely to prove routing: which session id the app calls for
 * which firm, that a disconnected firm never falls back to another firm's
 * session, that unconfirmed sends are failures, and that webhooks/acks are
 * scoped to the session's own firm.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import test, { after, before } from "node:test";

const KEY = "test-gateway-key-routing";
process.env.OPENWA_API_KEY = KEY;

const RUN = Date.now().toString(36);
const REAL_PORT = 18080;
const STUB_PORT = 18091;

let gateway: ChildProcess;
let stub: http.Server;
const stubCalls: Array<{ method: string; url: string; body: any }> = [];
const stubSessions = new Map<string, { status: string; phone: string | null; omitId?: boolean }>();

let svc: typeof import("@/lib/services/whatsapp");
let prisma: typeof import("@/lib/prisma").prisma;
const firms: Array<{ id: string; code: string; sessionName: string }> = [];

async function gw(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`http://localhost:${REAL_PORT}${path}`, {
    method,
    headers: { "X-API-Key": KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) as any };
}

before(async () => {
  const fs = await import("node:fs");
  fs.mkdirSync(`/tmp/wa-routing-${RUN}`, { recursive: true });
  gateway = spawn("node", ["/home/user/aurclean/scripts/openwa-server.mjs"], {
    env: { ...process.env, PORT: String(REAL_PORT), OPENWA_API_KEY: KEY },
    cwd: `/tmp/wa-routing-${RUN}`,
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`http://localhost:${REAL_PORT}/health`)).ok) break; } catch { /* waiting */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  stub = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      stubCalls.push({ method: req.method!, url: req.url!, body });
      const m = req.url!.match(/^\/api\/sessions\/([^/]+)(?:\/(\w+))?$/);
      const send = (code: number, data: unknown) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
      if (req.headers["x-api-key"] !== KEY) return send(401, { error: "bad key" });
      if (!m) return send(404, {});
      const s = stubSessions.get(m[1]);
      if (!m[2] && req.method === "GET") return s ? send(200, { success: true, sessionId: m[1], status: s.status, phoneNumber: s.status === "ready" ? s.phone : null }) : send(404, {});
      if (m[2] === "messages" || m[2] === "files") {
        if (!s || s.status !== "ready") return send(409, { error: "not ready" });
        return send(200, s.omitId ? { success: true } : { success: true, id: `MSG-${m[1]}-${stubCalls.length}` });
      }
      return send(200, { success: true });
    });
  }).listen(STUB_PORT);

  process.env.OPENWA_BASE_URL = `http://localhost:${STUB_PORT}`;
  ({ prisma } = await import("@/lib/prisma"));
  svc = await import("@/lib/services/whatsapp");

  for (const key of ["FALNIR", "DERALAKATTE", "BHATKAL"]) {
    const firm = await prisma.firm.create({ data: { code: `${key}${RUN}`.toUpperCase().slice(0, 20), name: `${key} WA Test` } });
    const session = await svc.getOrCreateFirmSession(firm.id);
    firms.push({ id: firm.id, code: firm.code, sessionName: session.sessionName });
  }
});

after(async () => {
  gateway?.kill();
  stub?.closeAllConnections();
  stub?.close();
  const ids = firms.map((f) => f.id);
  await prisma.whatsAppLog.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.branch.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.whatsAppSession.deleteMany({ where: { firmId: { in: ids } } });
  await prisma.firm.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

test("A1. Each firm has a distinct, stable session id derived from its own code", async () => {
  assert.equal(new Set(firms.map((f) => f.sessionName)).size, 3);
  for (const f of firms) assert.equal(f.sessionName, `whatsapp_${f.code.toLowerCase()}`);
  // Stable: asking again returns the same row, not a new session.
  const again = await svc.getOrCreateFirmSession(firms[0].id);
  assert.equal(again.sessionName, firms[0].sessionName);
});

test("A2. REAL gateway: three sessions run independently; logging one out leaves the others registered", async () => {
  for (const f of firms) {
    const started = await gw("/api/sessions", "POST", { sessionId: f.sessionName });
    assert.equal(started.status, 200);
    assert.equal(started.data.sessionId, f.sessionName);
  }
  const list = (await gw("/api/sessions")).data.map((s: any) => s.sessionId).sort();
  assert.deepEqual(list, firms.map((f) => f.sessionName).sort());

  // Honest status: no phone can pair in this sandbox, so nothing may claim to be connected.
  for (const f of firms) {
    const snap = (await gw(`/api/sessions/${f.sessionName}`)).data;
    assert.equal(snap.connected, false);
    assert.equal(snap.phoneNumber, null);
  }

  const out = await gw(`/api/sessions/${firms[0].sessionName}/logout`, "POST");
  assert.equal(out.data.sessionId, firms[0].sessionName);
  const after = (await gw("/api/sessions")).data.map((s: any) => s.sessionId);
  assert.ok(after.includes(firms[1].sessionName) && after.includes(firms[2].sessionName), "B and C still registered after A's logout");

  // A message for an unpaired session is refused by the gateway itself (never queued on another number).
  const send = await gw(`/api/sessions/${firms[1].sessionName}/messages`, "POST", { to: "9876543210", text: "hi" });
  assert.equal(send.status, 409);
});

test("B1. A firm's message goes through its own session only (protocol stub)", async () => {
  const [a, b, c] = firms;
  stubSessions.set(a.sessionName, { status: "ready", phone: "+919000000001" });
  stubSessions.set(b.sessionName, { status: "ready", phone: "+919000000002" });
  stubSessions.set(c.sessionName, { status: "disconnected", phone: null });
  stubCalls.length = 0;

  const resA = await svc.sendText(a.id, { phone: "9876543210", text: "from A" });
  const resB = await svc.sendText(b.id, { phone: "9876543210", text: "from B" });
  assert.equal(resA.status, "SENT");
  assert.equal(resB.status, "SENT");

  const posts = stubCalls.filter((x) => x.method === "POST");
  assert.deepEqual(posts.map((x) => x.url), [`/api/sessions/${a.sessionName}/messages`, `/api/sessions/${b.sessionName}/messages`]);

  const logs = await prisma.whatsAppLog.findMany({ where: { firmId: { in: [a.id, b.id] } }, orderBy: { sentAt: "asc" } });
  assert.deepEqual(logs.map((l) => [l.firmId, l.sessionId, l.status]), [[a.id, a.sessionName, "SENT"], [b.id, b.sessionName, "SENT"]]);
  assert.ok(logs.every((l) => l.externalId?.startsWith(`MSG-${l.sessionId}`)), "message id comes from that session's gateway reply");

  // Statuses and numbers are per firm.
  assert.equal((await svc.getSessionStatus(a.id)).phoneNumber, "+919000000001");
  assert.equal((await svc.getSessionStatus(b.id)).phoneNumber, "+919000000002");
  const sc = await svc.getSessionStatus(c.id);
  assert.equal(sc.connected, false);
  assert.equal(sc.phoneNumber, null);
});

test("B2. A disconnected firm never falls back to another firm's number", async () => {
  const [a, , c] = firms;
  stubCalls.length = 0;
  await assert.rejects(svc.sendText(c.id, { phone: "9876543210", text: "should not send" }), /not connected/i);
  assert.equal(stubCalls.filter((x) => x.method === "POST").length, 0, "no message reached any session (A's is ready but must not be used)");
  assert.equal(await prisma.whatsAppLog.count({ where: { firmId: c.id } }), 0, "nothing logged as sent");
  void a;
});

test("B3. Without a gateway-confirmed message id the send is a FAILURE, not a success", async () => {
  const [a] = firms;
  stubSessions.set(a.sessionName, { status: "ready", phone: "+919000000001", omitId: true });
  await assert.rejects(svc.sendText(a.id, { phone: "9876543210", text: "unconfirmed" }), /did not confirm/i);
  const log = await prisma.whatsAppLog.findFirstOrThrow({ where: { firmId: a.id, messageText: "unconfirmed" } });
  assert.equal(log.status, "FAILED");
  stubSessions.set(a.sessionName, { status: "ready", phone: "+919000000001" });
});

test("B4. Records from another firm cannot be attached to a send", async () => {
  const [a, b] = firms;
  const branch = await prisma.branch.create({ data: { firmId: b.id, code: `B${RUN}`, name: "B branch" } });
  const customer = await prisma.customer.create({ data: { firmId: b.id, code: `C${RUN}`, branchId: branch.id, name: "B customer", phone: "7022800001" } });
  await assert.rejects(svc.sendText(a.id, { phone: "9876543210", text: "x", customerId: customer.id }), /Customer not found/);
});

test("B5. Webhooks resolve the firm from the session id; acks never touch another firm's log", async () => {
  const [a, b] = firms;
  // Same gateway message id in two firms' logs (ids are only unique per session).
  await prisma.whatsAppLog.create({ data: { firmId: a.id, sessionId: a.sessionName, phone: "1", messageText: "a", externalId: "SHARED-ID", status: "SENT" } });
  await prisma.whatsAppLog.create({ data: { firmId: b.id, sessionId: b.sessionName, phone: "1", messageText: "b", externalId: "SHARED-ID", status: "SENT" } });

  const ack = await svc.handleWhatsAppWebhook({ event: "message.ack", sessionId: a.sessionName, messageId: "SHARED-ID", status: "READ" });
  assert.equal(ack.updated, true);
  assert.equal((await prisma.whatsAppLog.findFirstOrThrow({ where: { firmId: a.id, externalId: "SHARED-ID" } })).status, "READ");
  assert.equal((await prisma.whatsAppLog.findFirstOrThrow({ where: { firmId: b.id, externalId: "SHARED-ID" } })).status, "SENT");

  // A status event for an unknown session id is ignored; a known one updates only its own firm.
  assert.equal((await svc.handleWhatsAppWebhook({ event: "session.status", sessionId: "whatsapp_nobody", status: "ready", phoneNumber: "919999999999" })).updated, false);
  await svc.handleWhatsAppWebhook({ event: "session.status", sessionId: b.sessionName, status: "ready", phoneNumber: "919000000002" });
  const rows = await prisma.whatsAppSession.findMany({ where: { firmId: { in: firms.map((f) => f.id) } } });
  const byFirm = new Map(rows.map((r) => [r.firmId, r]));
  assert.equal(byFirm.get(b.id)!.connectedNumber, "+919000000002");
  assert.equal(byFirm.get(a.id)!.connectedNumber === "+919000000002", false);
  assert.equal(byFirm.get(firms[2].id)!.connectedNumber === "+919000000002", false);
});

test("B6. Webhook endpoint rejects callers without the gateway key", async () => {
  const res = await fetch("http://localhost:3000/api/whatsapp/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "session.status", sessionId: firms[0].sessionName, status: "ready", phoneNumber: "1" }) });
  assert.equal(res.status, 401);
  const bad = await fetch("http://localhost:3000/api/whatsapp/webhook", { method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": "wrong" }, body: "{}" });
  assert.equal(bad.status, 401);
});
