"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS, ROLE_LABELS, isGlobalRole } from "@/lib/rbac";
import { cuidSchema } from "@/lib/validations/common";
import { generateUniqueAccessCode } from "@/lib/access-code";
import {
  assertBranchAccess,
  assertFirmAccess,
  authorize,
  hasPermission,
  requireFirmId,
  requireWriteBranch,
} from "@/lib/session";
import {
  BusinessRuleError,
  NotFoundError,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { nextEmployeeCode } from "@/lib/sequence";
import {
  attendanceSchema,
  createStaffSchema,
  leaveDecisionSchema,
  leaveSchema,
  permissionOverrideSchema,
  regenerateAccessCodeSchema,
  updateStaffSchema,
} from "@/lib/validations/staff";

/** Only a super admin may mint another super admin. */
function assertCanAssignRole(actorRole: string, targetRole: string) {
  const privileged = ["SUPER_ADMIN"];
  if (privileged.includes(targetRole) && actorRole !== "SUPER_ADMIN") {
    throw new BusinessRuleError(
      `Only a super admin can assign the ${ROLE_LABELS[targetRole as keyof typeof ROLE_LABELS]} role`,
    );
  }
}

export async function createStaffAction(
  payload: unknown,
): Promise<ActionResult<{ id: string; employeeCode: string; accessCode: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.STAFF_MANAGE);
    const input = createStaffSchema.parse(payload);
    assertCanAssignRole(user.role, input.role);
    const firmId = requireFirmId(user);

    const branchId = isGlobalRole(user.role)
      ? (input.branchId ?? user.branchId ?? null)
      : await requireWriteBranch(user, input.branchId);

    if (branchId) {
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { firmId: true },
      });
      if (!branch || branch.firmId !== firmId) {
        throw new BusinessRuleError("That branch does not belong to your organization");
      }
    }

    const existing = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) throw new BusinessRuleError("That email address is already registered");

    const accessCode = await generateUniqueAccessCode();

    const created = await prisma.$transaction(async (tx) => {
      const employeeCode = await nextEmployeeCode(tx);

      const staff = await tx.user.create({
        data: {
          employeeCode,
          name: input.name,
          email: input.email,
          phone: input.phone ?? null,
          accessCode,
          role: input.role,
          branchId,
          firmId,
          staffProfile: {
            create: {
              department: input.department ?? null,
              designation: input.designation ?? null,
              dateOfJoining: input.dateOfJoining ?? new Date(),
              monthlySalary: input.monthlySalary,
              shiftId: input.shiftId ?? null,
              emergencyContact: input.emergencyContact ?? null,
              addressLine: input.addressLine ?? null,
            },
          },
          ...(input.licenseNumber || input.vehicleNumber || input.vehicleType
            ? {
                driver: {
                  create: {
                    licenseNumber: input.licenseNumber ?? null,
                    vehicleNumber: input.vehicleNumber ?? null,
                    vehicleType: input.vehicleType ?? null,
                  },
                },
              }
            : {}),
        },
        select: { id: true, employeeCode: true },
      });

      return staff;
    });

    await recordAudit({
      userId: user.id,
      branchId,
      action: "STAFF_CREATED",
      entity: "User",
      entityId: created.id,
      summary: `${input.name} (${ROLE_LABELS[input.role]}) added as ${created.employeeCode}`,
      after: { name: input.name, email: input.email, role: input.role, branchId },
    });

    revalidatePath("/staff");
    return { id: created.id, employeeCode: created.employeeCode ?? "", accessCode };
  });
}

export async function updateStaffAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.STAFF_MANAGE);
    const input = updateStaffSchema.parse(payload);
    assertCanAssignRole(user.role, input.role);

    const staff = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, branchId: true, firmId: true, role: true, name: true, email: true },
    });
    if (!staff) throw new NotFoundError("Staff member not found");
    assertBranchAccess(user, staff.branchId);
    assertFirmAccess(user, staff.firmId);
    assertCanAssignRole(user.role, staff.role);

    if (staff.id === user.id && input.status !== "ACTIVE") {
      throw new BusinessRuleError("You cannot deactivate your own account");
    }

    const branchId = isGlobalRole(user.role)
      ? (input.branchId ?? null)
      : await requireWriteBranch(user, input.branchId);

    if (branchId) {
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { firmId: true },
      });
      if (!branch || branch.firmId !== requireFirmId(user)) {
        throw new BusinessRuleError("That branch does not belong to your organization");
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: staff.id },
        data: {
          name: input.name,
          email: input.email,
          phone: input.phone ?? null,
          role: input.role,
          status: input.status,
          branchId,
        },
      });

      await tx.staffProfile.upsert({
        where: { userId: staff.id },
        create: {
          userId: staff.id,
          department: input.department ?? null,
          designation: input.designation ?? null,
          monthlySalary: input.monthlySalary,
          shiftId: input.shiftId ?? null,
          emergencyContact: input.emergencyContact ?? null,
          addressLine: input.addressLine ?? null,
        },
        update: {
          department: input.department ?? null,
          designation: input.designation ?? null,
          monthlySalary: input.monthlySalary,
          shiftId: input.shiftId ?? null,
          emergencyContact: input.emergencyContact ?? null,
          addressLine: input.addressLine ?? null,
        },
      });

    });

    await recordAudit({
      userId: user.id,
      branchId: branchId ?? staff.branchId,
      action: "STAFF_UPDATED",
      entity: "User",
      entityId: staff.id,
      summary: `Updated ${input.name}`,
      before: staff,
      after: { role: input.role, status: input.status, branchId },
    });

    revalidatePath("/staff");
    revalidatePath(`/staff/${staff.id}`);
    return null;
  });
}

export async function regenerateAccessCodeAction(
  payload: unknown,
): Promise<ActionResult<{ accessCode: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.STAFF_MANAGE);
    const input = regenerateAccessCodeSchema.parse(payload);

    const staff = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, branchId: true, firmId: true, name: true, role: true },
    });
    if (!staff) throw new NotFoundError("Staff member not found");
    assertBranchAccess(user, staff.branchId);
    assertFirmAccess(user, staff.firmId);
    assertCanAssignRole(user.role, staff.role);

    const accessCode = await generateUniqueAccessCode();

    await prisma.user.update({
      where: { id: staff.id },
      data: { accessCode },
    });

    // The new code itself is never written to the audit trail.
    await recordAudit({
      userId: user.id,
      branchId: staff.branchId,
      action: "STAFF_ACCESS_CODE_RESET",
      entity: "User",
      entityId: staff.id,
      summary: `Access code regenerated for ${staff.name}`,
    });

    revalidatePath(`/staff/${staff.id}`);
    return { accessCode };
  });
}

/** Grants or revokes a single permission for one user, over the role default. */
export async function setPermissionOverrideAction(
  payload: unknown,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.STAFF_MANAGE);
    const input = permissionOverrideSchema.parse(payload);

    const staff = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, branchId: true, firmId: true, name: true, role: true },
    });
    if (!staff) throw new NotFoundError("Staff member not found");
    assertBranchAccess(user, staff.branchId);
    assertFirmAccess(user, staff.firmId);
    assertCanAssignRole(user.role, staff.role);

    // A manager can never hand out access they do not themselves hold.
    if (input.granted && !hasPermission(user, input.permissionCode as never)) {
      throw new BusinessRuleError("You cannot grant a permission you do not hold");
    }

    const permission = await prisma.permission.findUnique({
      where: { code: input.permissionCode },
      select: { id: true, code: true },
    });
    if (!permission) throw new NotFoundError("Unknown permission");

    await prisma.userPermission.upsert({
      where: {
        userId_permissionId: { userId: staff.id, permissionId: permission.id },
      },
      create: {
        userId: staff.id,
        permissionId: permission.id,
        granted: input.granted,
      },
      update: { granted: input.granted },
    });

    await recordAudit({
      userId: user.id,
      branchId: staff.branchId,
      action: input.granted ? "PERMISSION_GRANTED" : "PERMISSION_REVOKED",
      entity: "User",
      entityId: staff.id,
      summary: `${permission.code} ${input.granted ? "granted to" : "revoked from"} ${staff.name}`,
    });

    revalidatePath(`/staff/${staff.id}`);
    return null;
  });
}

export async function clearPermissionOverrideAction(
  userId: string,
  permissionCode: string,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.STAFF_MANAGE);

    const staff = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, branchId: true, firmId: true, name: true },
    });
    if (!staff) throw new NotFoundError("Staff member not found");
    assertBranchAccess(user, staff.branchId);
    assertFirmAccess(user, staff.firmId);

    const permission = await prisma.permission.findUnique({
      where: { code: permissionCode },
      select: { id: true },
    });
    if (!permission) throw new NotFoundError("Unknown permission");

    await prisma.userPermission.deleteMany({
      where: { userId: staff.id, permissionId: permission.id },
    });

    await recordAudit({
      userId: user.id,
      branchId: staff.branchId,
      action: "PERMISSION_OVERRIDE_CLEARED",
      entity: "User",
      entityId: staff.id,
      summary: `${permissionCode} reset to role default for ${staff.name}`,
    });

    revalidatePath(`/staff/${staff.id}`);
    return null;
  });
}

export async function markAttendanceAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.STAFF_ATTENDANCE);
    const input = attendanceSchema.parse(payload);

    const staff = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, branchId: true, firmId: true, name: true },
    });
    if (!staff) throw new NotFoundError("Staff member not found");
    assertBranchAccess(user, staff.branchId);
    assertFirmAccess(user, staff.firmId);

    const date = new Date(input.date);
    date.setHours(0, 0, 0, 0);

    const withTime = (time: string | null | undefined) => {
      if (!time) return null;
      const [hours, minutes] = time.split(":").map(Number);
      if (Number.isNaN(hours)) return null;
      const stamp = new Date(date);
      stamp.setHours(hours, minutes || 0, 0, 0);
      return stamp;
    };

    await prisma.attendance.upsert({
      where: { userId_date: { userId: staff.id, date } },
      create: {
        userId: staff.id,
        branchId: staff.branchId,
        date,
        status: input.status,
        checkIn: withTime(input.checkIn),
        checkOut: withTime(input.checkOut),
        notes: input.notes ?? null,
      },
      update: {
        status: input.status,
        checkIn: withTime(input.checkIn),
        checkOut: withTime(input.checkOut),
        notes: input.notes ?? null,
      },
    });

    await recordAudit({
      userId: user.id,
      branchId: staff.branchId,
      action: "ATTENDANCE_RECORDED",
      entity: "Attendance",
      entityId: staff.id,
      summary: `${staff.name} marked ${input.status.toLowerCase()} on ${date.toDateString()}`,
    });

    revalidatePath("/staff");
    revalidatePath(`/staff/${staff.id}`);
    return null;
  });
}

export async function applyLeaveAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize([PERMISSIONS.STAFF_VIEW, PERMISSIONS.STAFF_MANAGE]);
    const input = leaveSchema.parse(payload);

    // Staff may only file leave for themselves unless they manage people.
    if (input.userId !== user.id && !hasPermission(user, PERMISSIONS.STAFF_MANAGE)) {
      throw new BusinessRuleError("You can only apply for your own leave");
    }
    if (input.userId !== user.id) {
      const target = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { branchId: true, firmId: true },
      });
      if (!target) throw new NotFoundError("Staff member not found");
      assertBranchAccess(user, target.branchId);
      assertFirmAccess(user, target.firmId);
    }
    if (input.toDate < input.fromDate) {
      throw new BusinessRuleError("The end date cannot be before the start date");
    }

    await prisma.leave.create({
      data: {
        userId: input.userId,
        type: input.type,
        fromDate: input.fromDate,
        toDate: input.toDate,
        reason: input.reason ?? null,
      },
    });

    revalidatePath("/staff");
    return null;
  });
}

export async function decideLeaveAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.STAFF_APPROVE_LEAVE);
    const input = leaveDecisionSchema.parse(payload);

    const leave = await prisma.leave.findUnique({
      where: { id: input.leaveId },
      include: { user: { select: { id: true, name: true, branchId: true, firmId: true } } },
    });
    if (!leave) throw new NotFoundError("Leave request not found");
    assertBranchAccess(user, leave.user.branchId);
    assertFirmAccess(user, leave.user.firmId);

    if (leave.status !== "PENDING") {
      throw new BusinessRuleError("This request has already been decided");
    }

    await prisma.leave.update({
      where: { id: leave.id },
      data: {
        status: input.status,
        approvedById: user.id,
        decidedAt: new Date(),
      },
    });

    await recordAudit({
      userId: user.id,
      branchId: leave.user.branchId,
      action: `LEAVE_${input.status}`,
      entity: "Leave",
      entityId: leave.id,
      summary: `${leave.user.name}'s leave ${input.status.toLowerCase()}`,
    });

    revalidatePath("/staff");
    return null;
  });
}


/**
 * Deactivating a staff account.
 *
 * People are never deleted: their name is on garment histories, payments and
 * audit entries, and removing the row would blank all of it. Deactivating locks
 * them out and takes them off the assignment lists while the trail stays intact.
 */
export async function setStaffStatusAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const actor = await authorize(PERMISSIONS.STAFF_MANAGE);
    const { staffId, status } = z
      .object({
        staffId: cuidSchema,
        status: z.enum(["ACTIVE", "SUSPENDED", "INACTIVE"]),
      })
      .parse(payload);

    const staff = await prisma.user.findUnique({
      where: { id: staffId },
      select: { id: true, name: true, status: true, branchId: true, firmId: true, role: true },
    });
    if (!staff) throw new NotFoundError("Staff member not found");
    if (staff.branchId) assertBranchAccess(actor, staff.branchId);
    assertFirmAccess(actor, staff.firmId);

    if (staff.id === actor.id) {
      throw new BusinessRuleError("You cannot change your own account status");
    }
    if (staff.role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") {
      throw new BusinessRuleError("Only a super admin can change a super admin");
    }
    if (staff.status === status) {
      throw new BusinessRuleError(`${staff.name} is already ${status.toLowerCase()}`);
    }

    await prisma.user.update({ where: { id: staffId }, data: { status } });
    await recordAudit({
      userId: actor.id,
      branchId: staff.branchId,
      action: "STAFF_STATUS_CHANGED",
      entity: "User",
      entityId: staffId,
      summary: `${staff.name}: ${staff.status} → ${status}`,
    });

    revalidatePath("/staff");
    revalidatePath(`/staff/${staffId}`);
    return null;
  });
}
