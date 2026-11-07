import { NextResponse } from "next/server";
import { handleWhatsAppWebhook, OPENWA_API_KEY } from "@/lib/services/whatsapp";

export const dynamic = "force-dynamic";

/** Secure Webhook Receiver for OpenWA events & status callbacks */
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || req.headers.get("x-api-key");

    // Fail closed: with no configured secret there is nothing to verify a
    // caller against, and a missing/mismatched header must always be
    // rejected — never treated as implicitly trusted.
    if (!OPENWA_API_KEY || !authHeader || authHeader.replace(/^Bearers+/i, "") !== OPENWA_API_KEY) {
      return NextResponse.json({ error: "Unauthorized webhook caller" }, { status: 401 });
    }

    const payload = await req.json();
    const result = await handleWhatsAppWebhook(payload);

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook processing error" },
      { status: 500 },
    );
  }
}
