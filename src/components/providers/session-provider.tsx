"use client";

import { SessionProvider } from "next-auth/react";

/**
 * Exposes the NextAuth session to client components via useSession(), which
 * is what the Firms module's "Enter firm" switcher needs to call
 * update({ activeFirmId }) and trigger the server-side jwt() callback's
 * firm-switch handling in src/auth.ts. Every page still reads the session
 * server-side via auth()/getCurrentUser() as before — this only adds the
 * client-side read/update path, it doesn't change how auth is enforced.
 */
export function AppSessionProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
