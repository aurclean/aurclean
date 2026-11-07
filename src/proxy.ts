import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = ["/login", "/forbidden"];

/**
 * Route gate. It only checks that a session exists — every permission decision
 * is made again on the server inside the page or action.
 *
 * Next 16 renamed the `middleware` convention to `proxy`; the runtime here is
 * Node, not edge, so this file may touch Node APIs if it ever needs to.
 */
export default auth(function proxy(request) {
  try {
    const { pathname } = request.nextUrl;
    const isLoggedIn = Boolean(request.auth?.user);
    const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

    if (!isLoggedIn && !isPublic) {
      const loginUrl = new URL("/login", request.nextUrl.origin);
      if (pathname !== "/") loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }

    if (isLoggedIn && pathname === "/login") {
      return NextResponse.redirect(new URL("/dashboard", request.nextUrl.origin));
    }

    return NextResponse.next();
  } catch (error) {
    console.error("[Proxy Execution Error]:", error);
    return NextResponse.next();
  }
});

export const config = {
  matcher: [
    // Everything except Next internals, the auth endpoints, the OpenWA
    // webhook (called by an external gateway with no session cookie —
    // it authenticates callers with its own shared-secret check instead),
    // and static assets.
    "/((?!api/auth|api/whatsapp/webhook|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)",
  ],
};
