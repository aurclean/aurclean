import { AuthError } from "next-auth";
import { NextResponse } from "next/server";

import { signIn } from "@/auth";

export const dynamic = "force-dynamic";

/** Customer-specific access link: exchanges the opaque token for a customer session. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const origin = new URL(request.url).origin;
  try {
    await signIn("customer", { mode: "token", token, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.redirect(new URL("/portal/login?link=invalid", origin));
    throw error;
  }
  return NextResponse.redirect(new URL("/portal", origin));
}
