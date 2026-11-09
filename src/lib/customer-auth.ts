import "server-only";

import crypto from "node:crypto";

import { prisma } from "@/lib/prisma";
import { generateOpaqueToken, hashOpaqueToken } from "@/lib/access-code";
import { logLoginEvent, lockoutFor } from "@/lib/login-security";
import { sendWhatsAppMessage } from "@/lib/services/whatsapp";

/**
 * Customer sign-in. A customer is only ever identified server-side, from one
 * of two proofs:
 *   1. a one-time code sent over THEIR FIRM'S WhatsApp number to the phone
 *      number the firm holds for them, or
 *   2. a customer-specific access link issued by the firm.
 * The resulting session carries the customer id and firm id; nothing the
 * browser sends later can change either.
 */

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_REQUESTS_PER_WINDOW = 3;
const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const digitsOf = (phone: string) => phone.replace(/\D/g, "");
const last10 = (phone: string) => digitsOf(phone).slice(-10);

function hashOtp(customerId: string, code: string) {
  return crypto.createHmac("sha256", process.env.ACCESS_CODE_PEPPER || process.env.AUTH_SECRET || "dev-only-access-code-pepper").update(`${customerId}:${code}`).digest("hex");
}

export async function findCustomerByPhone(firmId: string, phone: string) {
  const tail = last10(phone);
  if (tail.length < 10) return null;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "customers"
    WHERE "firmId" = ${firmId}
      AND right(regexp_replace("phone", '\\D', '', 'g'), 10) = ${tail}
    ORDER BY "createdAt" ASC
    LIMIT 1`;
  return rows[0] ? prisma.customer.findUnique({ where: { id: rows[0].id }, select: { id: true, firmId: true, name: true, phone: true } }) : null;
}

/** The same neutral answer is returned whether or not the number is registered. */
export const OTP_REQUEST_RESPONSE = "If this number is registered with the firm, a code has been sent on WhatsApp.";

export async function requestCustomerOtp(params: { firmCode: string; phone: string; ip: string }): Promise<{ sent: boolean; message: string }> {
  const neutral = { sent: false, message: OTP_REQUEST_RESPONSE };

  const lock = await lockoutFor(params.ip);
  if (lock.locked) return neutral;
  await logLoginEvent({ event: "OTP_REQUESTED", ip: params.ip, detail: `firm ${params.firmCode.toUpperCase()}` });

  const firm = await prisma.firm.findUnique({ where: { code: params.firmCode.trim().toUpperCase() }, select: { id: true, name: true, status: true } });
  if (!firm || firm.status !== "ACTIVE") return neutral;
  const customer = await findCustomerByPhone(firm.id, params.phone);
  if (!customer) return neutral;

  const recent = await prisma.customerOtp.count({ where: { customerId: customer.id, createdAt: { gte: new Date(Date.now() - OTP_TTL_MS) } } });
  if (recent >= OTP_MAX_REQUESTS_PER_WINDOW) return neutral;

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const otp = await prisma.customerOtp.create({
    data: { firmId: firm.id, customerId: customer.id, codeHash: hashOtp(customer.id, code), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });

  try {
    // Sent through THIS firm's own WhatsApp session; if it is not connected
    // the code is simply not delivered (never routed through another firm).
    await sendWhatsAppMessage({
      firmId: firm.id,
      phone: customer.phone,
      messageType: "CUSTOM",
      messageText: `${code} is your ${firm.name} sign-in code. It expires in 10 minutes. Do not share it.`,
      customerId: customer.id,
    });
    return { sent: true, message: OTP_REQUEST_RESPONSE };
  } catch {
    await prisma.customerOtp.delete({ where: { id: otp.id } }).catch(() => {});
    return neutral;
  }
}

export interface PortalIdentity {
  customerId: string;
  firmId: string;
  name: string;
  firmName: string;
}

export async function verifyCustomerOtp(params: { firmCode: string; phone: string; code: string; ip: string }): Promise<PortalIdentity | null> {
  if ((await lockoutFor(params.ip)).locked) return null;

  const firm = await prisma.firm.findUnique({ where: { code: params.firmCode.trim().toUpperCase() }, select: { id: true, name: true, status: true } });
  const customer = firm && firm.status === "ACTIVE" ? await findCustomerByPhone(firm.id, params.phone) : null;
  const fail = async (detail: string) => {
    await logLoginEvent({ event: "LOGIN_FAILED", firmId: firm?.id ?? null, customerId: customer?.id ?? null, ip: params.ip, detail: `customer otp: ${detail}` });
    return null;
  };
  if (!firm || !customer) return fail("unknown firm or number");

  const otp = await prisma.customerOtp.findFirst({
    where: { customerId: customer.id, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) return fail("no valid code");

  await prisma.customerOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
  const a = Buffer.from(otp.codeHash);
  const b = Buffer.from(hashOtp(customer.id, params.code.trim()));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail("wrong code");

  await prisma.customerOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  await logLoginEvent({ event: "LOGIN_SUCCESS", firmId: firm.id, customerId: customer.id, ip: params.ip, detail: "customer otp" });
  return { customerId: customer.id, firmId: firm.id, name: customer.name, firmName: firm.name };
}

export async function verifyCustomerToken(token: string, ip: string): Promise<PortalIdentity | null> {
  if ((await lockoutFor(ip)).locked) return null;
  const customer = await prisma.customer.findUnique({
    where: { portalTokenHash: hashOpaqueToken(token) },
    select: { id: true, name: true, firmId: true, portalTokenExpiresAt: true, firm: { select: { name: true, status: true } } },
  });
  if (!customer || !customer.portalTokenExpiresAt || customer.portalTokenExpiresAt < new Date() || customer.firm.status !== "ACTIVE") {
    await logLoginEvent({ event: "LOGIN_FAILED", ip, detail: "customer link invalid" });
    return null;
  }
  await logLoginEvent({ event: "LOGIN_SUCCESS", firmId: customer.firmId, customerId: customer.id, ip, detail: "customer link" });
  return { customerId: customer.id, firmId: customer.firmId, name: customer.name, firmName: customer.firm.name };
}

/** Issues a fresh customer-specific link (replacing any previous one). The token is returned once. */
export async function issuePortalLink(customerId: string, firmId: string): Promise<string> {
  const { token, hash } = generateOpaqueToken();
  const updated = await prisma.customer.updateMany({
    where: { id: customerId, firmId },
    data: { portalTokenHash: hash, portalTokenExpiresAt: new Date(Date.now() + LINK_TTL_MS) },
  });
  if (updated.count !== 1) throw new Error("Customer not found");
  return token;
}
