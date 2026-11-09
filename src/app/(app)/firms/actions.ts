"use server";

import { sessionIdForFirmCode } from "@/lib/services/whatsapp";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";
import { authorize } from "@/lib/session";
import {
  BusinessRuleError,
  NotFoundError,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { generateUniqueAccessCode, accessCodeData, issueAccessCode, revokeAccessCode } from "@/lib/access-code";
import { logLoginEvent } from "@/lib/login-security";
import { nextEmployeeCode } from "@/lib/sequence";
import { createFirmSchema, updateFirmSchema } from "@/lib/validations/firm";

/**
 * Creates a new tenant firm plus its Primary Admin user in one transaction.
 * Only a platform-level Super Admin (PLATFORM_ADMIN) may do this — a firm's
 * own Firm Admin (SUPER_ADMIN role) has no visibility into other firms at
 * all, let alone the ability to create one.
 */
export async function createFirmAction(
  payload: unknown,
): Promise<ActionResult<{ firmId: string; adminEmployeeCode: string; adminAccessCode: string }>> {
  return runAction(async () => {
    const actor = await authorize(PERMISSIONS.FIRM_MANAGE);
    const input = createFirmSchema.parse(payload);

    const [codeClash, emailClash] = await Promise.all([
      prisma.firm.findUnique({ where: { code: input.code }, select: { id: true } }),
      prisma.user.findUnique({ where: { email: input.adminEmail }, select: { id: true } }),
    ]);
    if (codeClash) throw new BusinessRuleError(`Firm code ${input.code} is already in use`);
    if (emailClash) throw new BusinessRuleError("That admin email address is already registered");

    const { code: accessCode, hash: accessCodeHash } = await generateUniqueAccessCode();

    const result = await prisma.$transaction(async (tx) => {
      // 1-2. Unique firmId (cuid) and the firm record.
      const firm = await tx.firm.create({
        data: {
          code: input.code,
          name: input.name,
          legalName: input.legalName ?? null,
          addressLine: input.addressLine ?? null,
          city: input.city ?? null,
          state: input.state ?? null,
          pincode: input.pincode ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          gstin: input.gstin ?? null,
          pan: input.pan ?? null,
          website: input.website ?? null,
          logoUrl: input.logoUrl || null,
          status: "ACTIVE",
        },
      });

      // First branch (every order/customer needs one).
      const branch = await tx.branch.create({
        data: {
          firmId: firm.id,
          code: `${input.code}-HO`.slice(0, 24),
          name: input.branchName || input.name,
          type: "HEAD_OFFICE",
          addressLine: input.addressLine ?? null,
          city: input.city ?? null,
          state: input.state ?? null,
          pincode: input.pincode ?? null,
          phone: input.branchPhone ?? input.phone ?? null,
          email: input.email ?? null,
          gstNumber: input.gstin ?? null,
        },
      });

      // 6. Firm-specific settings (currency, numbering, terms, branding).
      const settings: Array<[string, string, string]> = [
        ["company_name", input.name, "company"],
        ["default_currency", input.currency, "company"],
        ["invoice_prefix", input.invoicePrefix, "documents"],
        ["challan_prefix", input.challanPrefix, "documents"],
        ["receipt_prefix", "REC", "documents"],
      ];
      await tx.setting.createMany({
        data: settings.map(([key, value, category]) => ({ firmId: firm.id, key, value, category })),
      });

      // 7. Separate WhatsApp connection record, named after the firm.
      let sessionName = sessionIdForFirmCode(firm.code);
      if (await tx.whatsAppSession.findUnique({ where: { sessionName } })) {
        sessionName = sessionIdForFirmCode(firm.code, firm.id);
      }
      await tx.whatsAppSession.create({
        data: { firmId: firm.id, provider: "openwa", sessionName, displayName: firm.name },
      });

      // 3-5. The Firm Manager, bound to this firm, with a hashed access code.
      const employeeCode = await nextEmployeeCode(tx);
      const admin = await tx.user.create({
        data: {
          firmId: firm.id,
          branchId: branch.id,
          employeeCode,
          name: input.adminName,
          email: input.adminEmail,
          phone: input.adminPhone ?? null,
          ...accessCodeData(accessCodeHash),
          createdById: actor.id,
          role: "FIRM_MANAGER",
        },
        select: { id: true, employeeCode: true },
      });

      return { firm, admin };
    });

    await logLoginEvent({ event: "CODE_ISSUED", firmId: result.firm.id, userId: result.admin.id, detail: `by ${actor.id}` });
    await recordAudit({
      userId: actor.id,
      firmId: result.firm.id,
      action: "FIRM_CREATED",
      entity: "Firm",
      entityId: result.firm.id,
      summary: `${result.firm.name} (${result.firm.code}) created with Firm Manager ${input.adminName}`,
    });

    revalidatePath("/firms");
    // 8. The plaintext code is returned to the caller once; only its hash is stored.
    return {
      firmId: result.firm.id,
      adminEmployeeCode: result.admin.employeeCode ?? "",
      adminAccessCode: accessCode,
    };
  });
}

export async function updateFirmAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    await authorize(PERMISSIONS.FIRM_MANAGE);
    const input = updateFirmSchema.parse(payload);

    const existing = await prisma.firm.findUnique({ where: { id: input.id }, select: { id: true } });
    if (!existing) throw new NotFoundError("Firm not found");

    await prisma.firm.update({
      where: { id: input.id },
      data: {
        name: input.name,
        legalName: input.legalName ?? null,
        addressLine: input.addressLine ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        pincode: input.pincode ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        gstin: input.gstin ?? null,
        pan: input.pan ?? null,
        website: input.website ?? null,
      },
    });

    await recordAudit({
      firmId: input.id,
      action: "FIRM_UPDATED",
      entity: "Firm",
      entityId: input.id,
      summary: `${input.name} details updated`,
    });

    revalidatePath("/firms");
    revalidatePath(`/firms/${input.id}`);
    return null;
  });
}

/**
 * Activating or deactivating a firm. A deactivated firm's data is never
 * touched — only its users are immediately locked out of login, every API
 * action, scanning and WhatsApp, per getCurrentUser()'s live firm-status
 * check in src/lib/session.ts.
 */
export async function setFirmStatusAction(
  firmId: string,
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED",
): Promise<ActionResult<null>> {
  return runAction(async () => {
    await authorize(PERMISSIONS.FIRM_MANAGE);

    const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { id: true, name: true, status: true } });
    if (!firm) throw new NotFoundError("Firm not found");
    if (firm.status === status) {
      throw new BusinessRuleError(`${firm.name} is already ${status.toLowerCase()}`);
    }

    await prisma.firm.update({ where: { id: firmId }, data: { status } });

    await recordAudit({
      firmId,
      action: status === "ACTIVE" ? "FIRM_ACTIVATED" : status === "SUSPENDED" ? "FIRM_SUSPENDED" : "FIRM_DEACTIVATED",
      entity: "Firm",
      entityId: firmId,
      summary: `${firm.name} ${status === "ACTIVE" ? "activated" : status === "SUSPENDED" ? "suspended" : "deactivated"}`,
    });

    revalidatePath("/firms");
    revalidatePath(`/firms/${firmId}`);
    return null;
  });
}

/** Resets a firm's Primary Admin access code — shown once, never stored in plaintext anywhere else. */
export async function resetFirmAdminAccessCodeAction(
  userId: string,
): Promise<ActionResult<{ accessCode: string }>> {
  return runAction(async () => {
    await authorize(PERMISSIONS.FIRM_MANAGE);

    const admin = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, role: true, firmId: true },
    });
    if (!admin) throw new NotFoundError("Admin account not found");
    if (admin.role !== "FIRM_MANAGER") {
      throw new BusinessRuleError("This action only resets a firm's own admin account");
    }

    const accessCode = await issueAccessCode(userId);
    await logLoginEvent({ event: "CODE_REGENERATED", firmId: admin.firmId, userId });

    await recordAudit({
      firmId: admin.firmId,
      action: "FIRM_ADMIN_ACCESS_CODE_RESET",
      entity: "User",
      entityId: userId,
      summary: `Access code reset for ${admin.name}`,
    });

    revalidatePath(`/firms/${admin.firmId}`);
    return { accessCode };
  });
}

/** Revokes a Firm Manager's access code. They cannot sign in until a new one is issued. */
export async function revokeFirmAdminAccessCodeAction(userId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await authorize(PERMISSIONS.FIRM_MANAGE);
    const admin = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, role: true, firmId: true } });
    if (!admin) throw new NotFoundError("Account not found");
    if (admin.role !== "FIRM_MANAGER") throw new BusinessRuleError("This action only revokes a Firm Manager's access");

    await revokeAccessCode(userId);
    await logLoginEvent({ event: "CODE_REVOKED", firmId: admin.firmId, userId, detail: `by ${actor.id}` });
    await recordAudit({
      userId: actor.id,
      firmId: admin.firmId,
      action: "FIRM_ADMIN_ACCESS_CODE_REVOKED",
      entity: "User",
      entityId: userId,
      summary: `Access revoked for ${admin.name}`,
    });
    revalidatePath(`/firms/${admin.firmId}`);
    return null;
  });
}
