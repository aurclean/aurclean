"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { z } from "zod";

import { signIn } from "@/auth";
import { flattenZodError, type ActionResult } from "@/lib/action-result";
import { clientIp, lockoutFor, peekUserByCode } from "@/lib/login-security";
import { ROLE_LANDING_PATH } from "@/lib/rbac";

const loginSchema = z.object({
  accessCode: z.string().trim().min(4, "Enter your access code").max(24, "That code is too long"),
  callbackUrl: z.string().optional(),
});

export type LoginState = ActionResult<{ redirectTo: string }> | null;

function lockedMessage(retryAfterMs: number) {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60000));
  return `Too many failed attempts. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    accessCode: formData.get("accessCode"),
    callbackUrl: formData.get("callbackUrl") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: "Enter a valid access code", fieldErrors: flattenZodError(parsed.error) };
  }

  const { accessCode, callbackUrl } = parsed.data;
  const ip = clientIp(await headers());

  const before = await lockoutFor(ip);
  if (before.locked) return { ok: false, error: lockedMessage(before.retryAfterMs) };

  try {
    await signIn("credentials", { accessCode, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      // authorize() has already recorded the failure and applies the lockout.
      const after = await lockoutFor(ip);
      return {
        ok: false,
        error: after.locked ? lockedMessage(after.retryAfterMs) : "That access code was not recognised",
      };
    }
    console.error("[Login Action Error]:", error);
    return { ok: false, error: "Sign-in is temporarily unavailable. Please try again." };
  }

  const user = await peekUserByCode(accessCode);
  const landing = user ? ROLE_LANDING_PATH[user.role] : "/dashboard";
  // Only the platform and firm-manager landing areas honour a deep link;
  // field/QC staff always start on their own simple home screen.
  const safeCallback = callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : null;
  const allowCallback = user?.role === "FIRM_MANAGER" || user?.role === "PLATFORM_SUPER_ADMIN";

  return { ok: true, data: { redirectTo: allowCallback && safeCallback ? safeCallback : landing } };
}
