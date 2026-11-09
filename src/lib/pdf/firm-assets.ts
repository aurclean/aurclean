import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

/**
 * Loads a firm's own logo / signature image for embedding in a PDF.
 *
 * The image reference always comes from the firm's own settings
 * (`Setting.company_logo` / `Firm.logoUrl`) — there is deliberately NO
 * platform-wide fallback image. A firm with no logo configured prints no
 * logo; it must never inherit another firm's artwork.
 *
 * Supported references:
 *   - `data:image/png;base64,...`
 *   - `/api/files/<path>`  (local storage driver → ./uploads/<path>)
 *   - `/<path>`            (a file under ./public)
 *   - `https://...`        (object-storage / CDN URL)
 */

const PUBLIC_ROOT = path.join(process.cwd(), "public");
const UPLOADS_ROOT = path.join(process.cwd(), "uploads");
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 6000;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/** PDFKit can only embed PNG and JPEG. */
function isEmbeddable(buf: Buffer): boolean {
  return (
    (buf.length > 4 && buf.subarray(0, 4).equals(PNG_MAGIC)) ||
    (buf.length > 3 && buf.subarray(0, 3).equals(JPEG_MAGIC))
  );
}

function within(root: string, target: string): boolean {
  const normalised = path.normalize(target);
  return normalised.startsWith(root + path.sep);
}

async function readConfined(root: string, relative: string): Promise<Buffer | null> {
  const target = path.join(root, relative);
  if (!within(root, target)) return null;
  try {
    return await fs.readFile(target);
  } catch {
    return null;
  }
}

async function readPublic(relative: string): Promise<Buffer | null> {
  // Prefer a print-resolution sibling ("/logo.png" -> "/logo-pdf.png") when
  // one exists: PDFKit embeds images verbatim, so a multi-megapixel source
  // would balloon every generated document.
  const ext = path.extname(relative);
  if (ext) {
    const optimised = `${relative.slice(0, -ext.length)}-pdf${ext}`;
    const hit = await readConfined(PUBLIC_ROOT, optimised);
    if (hit) return hit;
  }
  return readConfined(PUBLIC_ROOT, relative);
}

/** Refuses loopback / private / link-local targets so a configured logo URL can't probe the internal network. */
function isPublicHttpsUrl(ref: string): boolean {
  let url: URL;
  try {
    url = new URL(ref);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host.startsWith("[") || host.includes(":")) return false; // IPv6 literals
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return false;
    }
  }
  return true;
}

export async function loadFirmImage(reference: string | null | undefined): Promise<Buffer | null> {
  const ref = reference?.trim();
  if (!ref) return null;

  let data: Buffer | null = null;
  try {
    if (ref.startsWith("data:")) {
      const match = /^data:image\/(?:png|jpe?g);base64,(.+)$/i.exec(ref);
      data = match ? Buffer.from(match[1], "base64") : null;
    } else if (ref.startsWith("/api/files/")) {
      data = await readConfined(UPLOADS_ROOT, decodeURIComponent(ref.slice("/api/files/".length)));
    } else if (ref.startsWith("/")) {
      data = await readPublic(decodeURIComponent(ref.slice(1)));
    } else if (isPublicHttpsUrl(ref)) {
      const res = await fetch(ref, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "error" });
      if (res.ok) {
        const bytes = Buffer.from(await res.arrayBuffer());
        data = bytes.length <= MAX_IMAGE_BYTES ? bytes : null;
      }
    }
  } catch {
    data = null;
  }

  if (!data || data.length > MAX_IMAGE_BYTES || !isEmbeddable(data)) return null;
  return data;
}
