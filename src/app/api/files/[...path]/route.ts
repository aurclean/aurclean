import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/session";

const ROOT = path.join(process.cwd(), "uploads");

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".pdf": "application/pdf",
};

/**
 * Serves files stored by the local storage driver. Production deployments use
 * S3/R2/Supabase and never hit this route, but even here the file is only
 * released to an authenticated user and only from inside the uploads root.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { path: segments } = await params;
  const target = path.join(ROOT, ...segments);
  const normalised = path.normalize(target);

  // Reject anything that escapes the uploads directory.
  if (!normalised.startsWith(ROOT + path.sep)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const file = await fs.readFile(normalised);
    const extension = path.extname(normalised).toLowerCase();
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
