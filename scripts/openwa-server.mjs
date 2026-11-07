import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import QRCode from "qrcode";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";

/**
 * Multi-session OpenWA REST gateway for AURCLEAN ERP (Baileys engine).
 *
 * Every ERP firm owns exactly one session id (wa_<firmId>), and every session
 * has its own Baileys socket, its own credentials directory and therefore its
 * own linked WhatsApp account. There is deliberately NO session-less route:
 * every operation names the session it acts on, so a request can never fall
 * through to "the" connected number.
 */

const PORT = process.env.PORT || 8080;
const API_KEY = process.env.OPENWA_API_KEY || "";
const AUTH_ROOT = path.join(process.cwd(), "_whatsapp_auth");
const WEBHOOK_URL = process.env.OPENWA_WEBHOOK_URL || "";
// Credentials from the single-session era lived directly in AUTH_ROOT. They
// are adopted by this one session id so the original firm keeps its login.
const LEGACY_SESSION_ID = process.env.OPENWA_LEGACY_SESSION_ID || "aurclean_session";

if (!API_KEY) {
  console.error("OPENWA_API_KEY is not set. Refusing to start an unauthenticated WhatsApp gateway.");
  process.exit(1);
}

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

/** @type {Map<string, {id:string, sock:any, status:string, qr:string|null, phone:string|null, lastConnectedAt:Date|null, stopped:boolean, retry:any}>} */
const sessions = new Map();

const authDirFor = (id) => path.join(AUTH_ROOT, id);

function adoptLegacyCredentials(id) {
  if (id !== LEGACY_SESSION_ID) return;
  const dir = authDirFor(id);
  if (fs.existsSync(dir) || !fs.existsSync(path.join(AUTH_ROOT, "creds.json"))) return;
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(AUTH_ROOT)) {
    const from = path.join(AUTH_ROOT, name);
    if (fs.statSync(from).isFile()) fs.renameSync(from, path.join(dir, name));
  }
  console.log(`[gateway] Adopted legacy credentials into session "${id}"`);
}

function hasSavedCredentials(id) {
  return fs.existsSync(path.join(authDirFor(id), "creds.json"));
}

async function notify(event) {
  if (!WEBHOOK_URL) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
      body: JSON.stringify(event),
    });
  } catch (err) {
    console.warn(`[gateway] Webhook delivery failed: ${err?.message}`);
  }
}

function setStatus(s, status) {
  if (s.status === status) return;
  s.status = status;
  notify({ event: "session.status", sessionId: s.id, status, phoneNumber: s.phone });
}

async function startSession(id) {
  let s = sessions.get(id);
  if (s?.sock && ["initializing", "qr_ready", "authenticating", "ready"].includes(s.status)) return s;
  if (!s) {
    s = { id, sock: null, status: "disconnected", qr: null, phone: null, lastConnectedAt: null, stopped: false, retry: null };
    sessions.set(id, s);
  }
  s.stopped = false;
  clearTimeout(s.retry);

  try {
    setStatus(s, "initializing");
    adoptLegacyCredentials(id);
    const { state, saveCreds } = await useMultiFileAuthState(authDirFor(id));
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

    const sock = makeWASocket({
      version,
      auth: state,
      browser: ["AURCLEAN ERP", "Chrome", "1.0.0"],
      connectTimeoutMs: 30000,
      defaultQueryTimeoutMs: 30000,
    });
    s.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.update", (updates) => {
      for (const u of updates) {
        const code = u.update?.status;
        // Baileys: 3 = delivered to device, 4 = read.
        const status = code === 4 ? "READ" : code === 3 ? "DELIVERED" : null;
        if (status && u.key?.id && u.key.fromMe) {
          notify({ event: "message.ack", sessionId: id, messageId: u.key.id, status });
        }
      }
    });

    sock.ev.on("connection.update", async (update) => {
      // Ignore events from a socket that has since been replaced or stopped.
      if (s.sock !== sock) return;
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          s.qr = await QRCode.toDataURL(qr);
          setStatus(s, "qr_ready");
        } catch (e) {
          console.warn(`[gateway:${id}] QR render error:`, e);
        }
      }

      if (connection === "connecting" && s.status !== "qr_ready") setStatus(s, "authenticating");

      if (connection === "open") {
        s.qr = null;
        s.lastConnectedAt = new Date();
        const raw = (sock.user?.id || "").replace(/@.*$/, "").replace(/:.*$/, "").replace(/\D/g, "");
        s.phone = raw ? (raw.length === 10 ? `+91 ${raw}` : `+${raw}`) : null;
        setStatus(s, "ready");
        console.log(`[gateway:${id}] Connected as ${s.phone ?? "unknown number"}`);
      }

      if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        s.qr = null;
        s.phone = null;
        if (code === DisconnectReason.loggedOut) {
          fs.rmSync(authDirFor(id), { recursive: true, force: true });
          s.sock = null;
          setStatus(s, "disconnected");
          console.log(`[gateway:${id}] Logged out from WhatsApp.`);
        } else if (!s.stopped) {
          setStatus(s, "disconnected");
          console.log(`[gateway:${id}] Connection closed (code ${code ?? "unknown"}); reconnecting...`);
          s.retry = setTimeout(() => startSession(id), 4000);
        }
      }
    });
  } catch (err) {
    s.sock = null;
    setStatus(s, "failed");
    console.error(`[gateway:${id}] Socket initialization error:`, err);
  }
  return s;
}

async function stopSession(id, { logout }) {
  const s = sessions.get(id);
  if (s) {
    s.stopped = true;
    clearTimeout(s.retry);
    if (s.sock) {
      if (logout) await s.sock.logout().catch(() => {});
      try { s.sock.end(undefined); } catch {}
    }
    s.sock = null;
    s.qr = null;
    s.phone = null;
    setStatus(s, "disconnected");
  }
  if (logout) fs.rmSync(authDirFor(id), { recursive: true, force: true });
}

function snapshot(id) {
  const s = sessions.get(id);
  if (!s) {
    // Known on disk but not running (e.g. gateway restarted) vs. never created.
    if (!hasSavedCredentials(id)) return null;
    return { sessionId: id, status: "stopped", connected: false, phoneNumber: null, qrCode: null, lastConnectedAt: null };
  }
  const ready = s.status === "ready";
  return {
    sessionId: id,
    status: s.status,
    connected: ready,
    phoneNumber: ready ? s.phone : null,
    qrCode: s.status === "qr_ready" ? s.qr : null,
    lastConnectedAt: s.lastConnectedAt,
  };
}

function parseJson(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); }
    });
  });
}

function sendResponse(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function keyMatches(provided) {
  if (!provided) return false;
  const given = String(provided).replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(API_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function toJid(raw) {
  const digits = String(raw).replace(/\D/g, "");
  return `${digits.length === 10 ? `91${digits}` : digits}@s.whatsapp.net`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/" || url.pathname === "/health" || url.pathname === "/api/health") {
    sendResponse(res, 200, { status: "ok", service: "OpenWA multi-session gateway", sessions: sessions.size });
    return;
  }

  const provided = req.headers["x-api-key"] || req.headers["authorization"] || req.headers["api-key"];
  if (!keyMatches(provided)) {
    sendResponse(res, 401, { error: "Unauthorized: Invalid OpenWA API Key" });
    return;
  }

  // POST /api/sessions  { sessionId }  — create/start
  if (req.method === "POST" && url.pathname === "/api/sessions") {
    const body = await parseJson(req);
    const id = String(body.sessionId || body.name || "");
    if (!SESSION_ID_RE.test(id)) return sendResponse(res, 400, { error: "Invalid sessionId" });
    await startSession(id);
    return sendResponse(res, 200, { success: true, ...snapshot(id) });
  }

  if (req.method === "GET" && url.pathname === "/api/sessions") {
    return sendResponse(res, 200, [...sessions.keys()].map(snapshot).filter(Boolean));
  }

  const m = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/([a-z]+))?$/);
  if (!m) return sendResponse(res, 404, { error: "Endpoint not found on OpenWA Gateway" });
  const [, id, action] = m;
  if (!SESSION_ID_RE.test(id)) return sendResponse(res, 400, { error: "Invalid sessionId" });

  if (req.method === "GET" && !action) {
    const snap = snapshot(id);
    return snap ? sendResponse(res, 200, { success: true, ...snap }) : sendResponse(res, 404, { error: "Session not found" });
  }

  if (req.method === "GET" && action === "qr") {
    const snap = snapshot(id);
    if (!snap) return sendResponse(res, 404, { error: "Session not found" });
    if (snap.status === "qr_ready" && snap.qrCode) return sendResponse(res, 200, { success: true, ...snap });
    return sendResponse(res, 400, {
      success: false,
      error: snap.status === "ready" ? "WhatsApp is already connected." : "QR code is not ready yet.",
      status: snap.status,
    });
  }

  if (req.method === "POST" && action === "start") {
    await startSession(id);
    return sendResponse(res, 200, { success: true, ...snapshot(id) });
  }

  if ((req.method === "POST" && (action === "logout" || action === "stop")) || (req.method === "DELETE" && !action)) {
    await stopSession(id, { logout: action !== "stop" });
    console.log(`[gateway:${id}] Session ${action === "stop" ? "stopped" : "logged out and credentials cleared"}.`);
    return sendResponse(res, 200, { success: true, sessionId: id, status: "disconnected" });
  }

  if (req.method === "POST" && (action === "messages" || action === "files")) {
    const s = sessions.get(id);
    if (!s || s.status !== "ready" || !s.sock) {
      return sendResponse(res, 409, { success: false, error: `WhatsApp session is not ready (status: ${s?.status ?? "unknown"})` });
    }
    const body = await parseJson(req);
    const rawTo = body.to || body.chatId || body.phone;
    if (!rawTo) return sendResponse(res, 400, { success: false, error: "Missing required parameter: 'to'" });
    const jid = toJid(rawTo);

    try {
      let result;
      if (action === "messages") {
        const text = body.text || body.message;
        if (!text) return sendResponse(res, 400, { success: false, error: "Missing required parameter: 'text'" });
        result = await s.sock.sendMessage(jid, { text });
      } else {
        const base64Data = body.file || body.base64;
        if (!base64Data) return sendResponse(res, 400, { success: false, error: "Missing required parameter: 'file' (base64)" });
        result = await s.sock.sendMessage(jid, {
          document: Buffer.from(String(base64Data).replace(/^data:.*?;base64,/, ""), "base64"),
          mimetype: "application/pdf",
          fileName: body.filename || "document.pdf",
          caption: body.caption || body.text || "",
        });
      }
      const msgId = result?.key?.id;
      if (!msgId) return sendResponse(res, 502, { success: false, error: "WhatsApp did not return a message id" });
      console.log(`[gateway:${id}] Sent ${action === "files" ? "document" : "message"} (ID: ${msgId})`);
      return sendResponse(res, 200, { success: true, id: msgId, messageId: msgId, status: "SENT" });
    } catch (err) {
      console.error(`[gateway:${id}] Send error:`, err);
      return sendResponse(res, 500, { success: false, error: err?.message || "Failed to dispatch WhatsApp message" });
    }
  }

  sendResponse(res, 404, { error: "Endpoint not found on OpenWA Gateway" });
});

server.listen(PORT, () => {
  console.log(`OpenWA multi-session gateway listening on http://localhost:${PORT}`);
  // Resume every session that already has a paired login.
  fs.mkdirSync(AUTH_ROOT, { recursive: true });
  const ids = new Set(fs.readdirSync(AUTH_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory() && SESSION_ID_RE.test(d.name)).map((d) => d.name));
  if (fs.existsSync(path.join(AUTH_ROOT, "creds.json"))) ids.add(LEGACY_SESSION_ID);
  for (const id of ids) startSession(id);
});
