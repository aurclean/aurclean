"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { z } from "zod";

import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { flattenZodError, type ActionResult } from "@/lib/action-result";
import { ROLE_LANDING_PATH } from "@/lib/rbac";

const loginSchema = z.object({
  accessCode: z
    .string()
    .trim()
    .min(4, "Enter your access code")
    .max(12, "That code is too long"),
  callbackUrl: z.string().optional(),
});

export type LoginState = ActionResult<{ redirectTo: string }> | null;

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    accessCode: formData.get("accessCode"),
    callbackUrl: formData.get("callbackUrl") ?? undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: "Enter a valid access code",
      fieldErrors: flattenZodError(parsed.error),
    };
  }

  const { accessCode, callbackUrl } = parsed.data;

  // Throttle by IP and by the code itself, so neither a single client nor a
  // single account can be hammered by trial and error.
  const headerList = await headers();
  const ip =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    "unknown";

  for (const key of [`login:ip:${ip}`, `login:code:${accessCode}`]) {
    const limit = rateLimit(key, RATE_LIMITS.LOGIN.limit, RATE_LIMITS.LOGIN.windowMs);
    if (!limit.success) {
      return {
        ok: false,
        error: "Too many attempts. Please try again in a few minutes.",
      };
    }
  }

  try {
    const candidate = await prisma.user.findUnique({
      where: { accessCode },
      select: { firm: { select: { status: true } } },
    });
    if (candidate?.firm && candidate.firm.status !== "ACTIVE") {
      return {
        ok: false,
        error: "This firm is currently inactive. Please contact the system administrator.",
      };
    }

    try {
      await signIn("credentials", { accessCode, redirect: false });
    } catch (error) {
      if (error instanceof AuthError) {
        await recordAudit({
          action: "LOGIN_FAILED",
          entity: "User",
          summary: "Failed sign-in attempt with an invalid access code",
        }).catch(() => {});
        return { ok: false, error: "That access code was not recognised" };
      }
      throw error;
    }

    const user = await prisma.user.findUnique({
      where: { accessCode },
      select: { id: true, branchId: true, firmId: true, role: true },
    });

    if (user) {
      await recordAudit({
        userId: user.id,
        branchId: user.branchId,
        firmId: user.firmId,
        action: "LOGIN",
        entity: "User",
        entityId: user.id,
        summary: "Signed in with an access code",
      }).catch(() => {});
    }

    const landing = user ? ROLE_LANDING_PATH[user.role] : "/dashboard";
    const target =
      user?.role !== "SCANNER" &&
      callbackUrl &&
      callbackUrl.startsWith("/") &&
      !callbackUrl.startsWith("//")
        ? callbackUrl
        : landing;

    return { ok: true, data: { redirectTo: target } };
  } catch (error) {
    console.error("[Login Action Error]:", error);

    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("DATABASE_URL") || msg.includes("connect") || msg.includes("Prisma") || msg.includes("pg")) {
      return {
        ok: false,
        error: "Database connection failed. Please check DATABASE_URL in Vercel environment variables.",
      };
    }
    if (msg.includes("AUTH_SECRET") || msg.includes("Secret")) {
      return {
        ok: false,
        error: "Authentication configuration missing. Please ensure AUTH_SECRET is set in Vercel environment variables.",
      };
    }

    return {
      ok: false,
      error: "That access code was not recognised or a server error occurred. Please verify server logs.",
    };
  }
}
