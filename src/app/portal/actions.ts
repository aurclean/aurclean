"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { z } from "zod";

import { signIn, signOut } from "@/auth";
import { clientIp } from "@/lib/login-security";
import { requestCustomerOtp } from "@/lib/customer-auth";

const requestSchema = z.object({ firmCode: z.string().trim().min(2).max(20), phone: z.string().trim().min(8).max(20) });
const verifySchema = requestSchema.extend({ code: z.string().trim().regex(/^\d{6}$/) });

export async function requestOtpAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter your firm code and mobile number." };
  const ip = clientIp(await headers());
  const result = await requestCustomerOtp({ ...parsed.data, ip });
  return { ok: true, message: result.message };
}

export async function verifyOtpAction(input: unknown): Promise<{ ok: boolean; message: string }> {
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter the 6-digit code." };
  try {
    await signIn("customer", { mode: "otp", ...parsed.data, redirect: false });
    return { ok: true, message: "Signed in" };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, message: "That code is not valid or has expired." };
    throw error;
  }
}

export async function portalSignOutAction() {
  await signOut({ redirectTo: "/portal/login" });
}
