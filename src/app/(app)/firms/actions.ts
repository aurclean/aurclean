"use server";

import { sessionIdForFirm } from "@/lib/services/whatsapp";
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
import { generateUniqueAccessCode } from "@/lib/access-code";
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
    await authorize(PERMISSIONS.FIRM_MANAGE);
    const input = createFirmSchema.parse(payload);

    const [codeClash, emailClash] = await Promise.all([
      prisma.firm.findUnique({ where: { code: input.code }, select: { id: true } }),
      prisma.user.findUnique({ where: { email: input.adminEmail }, select: { id: true } }),
    ]);
    if (codeClash) throw new BusinessRuleError(`Firm code ${input.code} is already in use`);
    if (emailClash) throw new BusinessRuleError("That admin email address is already registered");

    const accessCode = await generateUniqueAccessCode();

    const result = await prisma.$transaction(async (tx) => {
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
          status: "ACTIVE",
        },
      });

      // Each firm gets its own (not yet connected) WhatsApp session record.
      await tx.whatsAppSession.create({
        data: { firmId: firm.id, provider: "openwa", sessionName: sessionIdForFirm(firm.id), displayName: firm.name },
      });

      const employeeCode = await nextEmployeeCode(tx);
      const admin = await tx.user.create({
        data: {
          firmId: firm.id,
          employeeCode,
          name: input.adminName,
          email: input.adminEmail,
          phone: input.adminPhone ?? null,
          accessCode,
          role: "SUPER_ADMIN",
        },
        select: { id: true, employeeCode: true },
      });

      return { firm, admin };
    });

    await recordAudit({
      firmId: result.firm.id,
      action: "FIRM_CREATED",
      entity: "Firm",
      entityId: result.firm.id,
      summary: `${result.firm.name} (${result.firm.code}) created with admin ${input.adminName}`,
    });

    revalidatePath("/firms");
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
  status: "ACTIVE" | "INACTIVE",
): Promise<ActionResult<null>> {
  return runAction(async () => {
    await authorize(PERMISSIONS.FIRM_MANAGE);

    const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { id: true, name: true, status: true } });
    if (!firm) throw new NotFoundError("Firm not found");
    if (firm.status === status) {
      throw new BusinessRuleError(`${firm.name} is already ${status === "ACTIVE" ? "active" : "inactive"}`);
    }

    await prisma.firm.update({ where: { id: firmId }, data: { status } });

    await recordAudit({
      firmId,
      action: status === "ACTIVE" ? "FIRM_ACTIVATED" : "FIRM_DEACTIVATED",
      entity: "Firm",
      entityId: firmId,
      summary: `${firm.name} ${status === "ACTIVE" ? "activated" : "deactivated"}`,
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
    if (admin.role !== "SUPER_ADMIN") {
      throw new BusinessRuleError("This action only resets a firm's own admin account");
    }

    const accessCode = await generateUniqueAccessCode();
    await prisma.user.update({ where: { id: userId }, data: { accessCode } });

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
