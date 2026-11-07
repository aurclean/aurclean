import "server-only";
import { prisma } from "@/lib/prisma";

const CODE_LENGTH = 6;

function randomDigits(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += Math.floor(Math.random() * 10);
  return out;
}

/** A short numeric code, guaranteed unique against every account issued so far. */
export async function generateUniqueAccessCode(): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const code = randomDigits(CODE_LENGTH);
    const existing = await prisma.user.findUnique({
      where: { accessCode: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique access code — try again");
}
