import "server-only";

import crypto from "node:crypto";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Access codes identify exactly one user (and therefore one role and one
 * firm). They are never stored: only HMAC-SHA256(pepper, code) is, and the
 * plaintext is shown to the issuer exactly once.
 *
 * Codes are 6 random digits (CSPRNG, uniform, 000000-999999) — short enough to
 * type at a counter. Because the space is small, security rests on the
 * database-backed sign-in lockout (login-security.ts), not on code entropy.
 */
const CODE_DIGITS = 6;

export function normalizeAccessCode(raw: string): string {
  return raw.replace(/[\s-]+/g, "").toUpperCase();
}

function pepper(): string {
  const value = process.env.ACCESS_CODE_PEPPER || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error("ACCESS_CODE_PEPPER (or AUTH_SECRET) must be set to hash access codes in production");
  }
  return "dev-only-access-code-pepper";
}

export function hashAccessCode(raw: string): string {
  return crypto.createHmac("sha256", pepper()).update(normalizeAccessCode(raw)).digest("hex");
}

export function generateAccessCode(): string {
  return String(crypto.randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, "0");
}

/** A fresh code plus its hash, guaranteed not to collide with any issued code. */
export async function generateUniqueAccessCode(db: Db = prisma): Promise<{ code: string; hash: string }> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const code = generateAccessCode();
    const hash = hashAccessCode(code);
    const clash = await db.user.findUnique({ where: { accessCodeHash: hash }, select: { id: true } });
    if (!clash) return { code, hash };
  }
  throw new Error("Could not generate a unique access code — try again");
}

/** Data fragment that installs a new code on a user (clearing any legacy plaintext and lockout). */
export function accessCodeData(hash: string) {
  return {
    accessCodeHash: hash,
    accessCode: null,
    accessCodeIssuedAt: new Date(),
    failedLoginCount: 0,
    lockedUntil: null,
  };
}

/**
 * Issues (or re-issues) a code for an existing user. The previous code stops
 * working immediately. Returns the plaintext — the only time it exists.
 */
export async function issueAccessCode(userId: string, db: Db = prisma): Promise<string> {
  const { code, hash } = await generateUniqueAccessCode(db);
  await db.user.update({ where: { id: userId }, data: accessCodeData(hash) });
  return code;
}

/** Revokes a user's code: nothing can sign in as them until a new one is issued. */
export async function revokeAccessCode(userId: string, db: Db = prisma): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { accessCodeHash: null, accessCode: null, accessCodeIssuedAt: null },
  });
}

/** High-entropy URL-safe token (customer links, etc.) and its hash. */
export function generateOpaqueToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: crypto.createHmac("sha256", pepper()).update(token).digest("hex") };
}

export function hashOpaqueToken(token: string): string {
  return crypto.createHmac("sha256", pepper()).update(token).digest("hex");
}
