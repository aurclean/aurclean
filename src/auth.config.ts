import type { NextAuthConfig } from "next-auth";

/**
 * Ensure URL environment variables (NEXTAUTH_URL, AUTH_URL, VERCEL_URL) have a
 * valid protocol scheme (https://). Vercel sets VERCEL_URL to
 * "my-app.vercel.app" (without https://), and users often set NEXTAUTH_URL
 * without https:// in Vercel settings, causing NextAuth to throw
 * TypeError: Invalid URL (code: ERR_INVALID_URL, input: 'aura-cleaning-tau.vercel.app').
 */
function sanitizeUrlEnv(key: string) {
  const val = process.env[key];
  if (!val) return;
  const trimmed = val.trim();
  if (!trimmed) return;
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    process.env[key] = `https://${trimmed}`;
  }
}

sanitizeUrlEnv("NEXTAUTH_URL");
sanitizeUrlEnv("AUTH_URL");
sanitizeUrlEnv("VERCEL_URL");

export const authConfig = {
  // No hardcoded fallback in production: sessions signed with a publicly
  // known secret could be forged. Development gets a local-only default.
  secret:
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    (process.env.NODE_ENV === "production" ? undefined : "dev-only-auth-secret-not-for-production"),
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 12,
  },
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth }) {
      return Boolean(auth?.user);
    },
  },
} satisfies NextAuthConfig;
