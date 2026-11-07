"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { cuidSchema } from "@/lib/validations/common";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";
import {
  assertBranchAccess,
  assertFirmAccess,
  authorize,
  requireFirmId,
  requireWriteBranch,
} from "@/lib/session";
import {
  BusinessRuleError,
  NotFoundError,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { formatCurrency } from "@/lib/money";
import { nextExpenseNumber } from "@/lib/sequence";
import { resendNotification } from "@/lib/services/notifications";
import {
  branchSchema,
  expenseDecisionSchema,
  expenseSchema,
  garmentTypeSchema,
  notificationTemplateSchema,
  serviceRateSchema,
  serviceSchema,
  settingSchema,
} from "@/lib/validations/settings";

export async function saveBranchAction(
  payload: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.BRANCH_MANAGE);
    const input = branchSchema.parse(payload);

    if (input.id && input.parentId === input.id) {
      throw new BusinessRuleError("A branch cannot be its own parent");
    }

    const data = {
      code: input.code,
      name: input.name,
      type: input.type,
      parentId: input.parentId ?? null,
      addressLine: input.addressLine ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      pincode: input.pincode ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      gstNumber: input.gstNumber ?? null,
      openingTime: input.openingTime ?? null,
      closingTime: input.closingTime ?? null,
      isActive: input.isActive,
    };

    if (input.id) {
      const existing = await prisma.branch.findUnique({ where: { id: input.id }, select: { firmId: true } });
      if (!existing) throw new BusinessRuleError("Branch not found");
      if (existing.firmId !== requireFirmId(user)) {
        throw new BusinessRuleError("This branch belongs to a different organization");
      }
    }

    const branch = input.id
      ? await prisma.branch.update({ where: { id: input.id }, data })
      : await prisma.branch.create({ data: { ...data, firmId: requireFirmId(user) } });

    await recordAudit({
      userId: user.id,
      branchId: branch.id,
      action: input.id ? "BRANCH_UPDATED" : "BRANCH_CREATED",
      entity: "Branch",
      entityId: branch.id,
      summary: `${branch.code} — ${branch.name}`,
    });

    revalidatePath("/settings/branches");
    return { id: branch.id };
  });
}

export async function saveServiceAction(
  payload: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.CATALOGUE_MANAGE);
    const input = serviceSchema.parse(payload);

    const data = {
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      pricingMode: input.pricingMode,
      basePrice: input.basePrice,
      turnaroundHours: input.turnaroundHours,
      stages: input.stages,
      isActive: input.isActive,
    };

    if (input.id) {
      const existing = await prisma.service.findUnique({ where: { id: input.id }, select: { firmId: true } });
      if (!existing) throw new BusinessRuleError("Service not found");
      if (existing.firmId !== requireFirmId(user)) {
        throw new BusinessRuleError("This service belongs to a different organization");
      }
    }

    const service = input.id
      ? await prisma.service.update({ where: { id: input.id }, data })
      : await prisma.service.create({ data: { ...data, firmId: requireFirmId(user) } });

    await recordAudit({
      userId: user.id,
      branchId: user.branchId,
      action: input.id ? "SERVICE_UPDATED" : "SERVICE_CREATED",
      entity: "Service",
      entityId: service.id,
      summary: `${service.code} — ${service.name} at ${formatCurrency(service.basePrice)}`,
    });

    revalidatePath("/settings/catalogue");
    return { id: service.id };
  });
}

export async function saveGarmentTypeAction(
  payload: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.CATALOGUE_MANAGE);
    const input = garmentTypeSchema.parse(payload);

    const data = {
      code: input.code,
      name: input.name,
      category: input.category.toUpperCase(),
      isActive: input.isActive,
    };

    if (input.id) {
      const existing = await prisma.garmentType.findUnique({ where: { id: input.id }, select: { firmId: true } });
      if (!existing) throw new BusinessRuleError("Garment type not found");
      if (existing.firmId !== requireFirmId(user)) {
        throw new BusinessRuleError("This garment type belongs to a different organization");
      }
    }

    const garmentType = input.id
      ? await prisma.garmentType.update({ where: { id: input.id }, data })
      : await prisma.garmentType.create({ data: { ...data, firmId: requireFirmId(user) } });

    await recordAudit({
      userId: user.id,
      branchId: user.branchId,
      action: input.id ? "GARMENT_TYPE_UPDATED" : "GARMENT_TYPE_CREATED",
      entity: "GarmentType",
      entityId: garmentType.id,
      summary: `${garmentType.code} — ${garmentType.name}`,
    });

    revalidatePath("/settings/catalogue");
    return { id: garmentType.id };
  });
}

export async function saveServiceRateAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.CATALOGUE_MANAGE);
    const input = serviceRateSchema.parse(payload);
    const firmId = requireFirmId(user);

    const [service, garmentType] = await Promise.all([
      prisma.service.findUnique({ where: { id: input.serviceId }, select: { firmId: true } }),
      prisma.garmentType.findUnique({ where: { id: input.garmentTypeId }, select: { firmId: true } }),
    ]);
    if (!service || service.firmId !== firmId || !garmentType || garmentType.firmId !== firmId) {
      throw new BusinessRuleError("That service or garment type does not belong to your organization");
    }

    await prisma.serviceRate.upsert({
      where: {
        serviceId_garmentTypeId: {
          serviceId: input.serviceId,
          garmentTypeId: input.garmentTypeId,
        },
      },
      create: input,
      update: { price: input.price },
    });

    await recordAudit({
      userId: user.id,
      branchId: user.branchId,
      action: "SERVICE_RATE_SAVED",
      entity: "ServiceRate",
      summary: `Rate set to ${formatCurrency(input.price)}`,
    });

    revalidatePath("/settings/catalogue");
    return null;
  });
}

export async function saveTemplateAction(
  payload: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.NOTIFICATION_MANAGE);
    const input = notificationTemplateSchema.parse(payload);

    const data = {
      code: input.code,
      name: input.name,
      channel: input.channel,
      event: input.event,
      subject: input.subject ?? null,
      body: input.body,
      isActive: input.isActive,
    };

    const template = input.id
      ? await prisma.notificationTemplate.update({ where: { id: input.id }, data })
      : await prisma.notificationTemplate.create({ data });

    await recordAudit({
      userId: user.id,
      branchId: user.branchId,
      action: input.id ? "TEMPLATE_UPDATED" : "TEMPLATE_CREATED",
      entity: "NotificationTemplate",
      entityId: template.id,
      summary: `${template.code} (${template.channel})`,
    });

    revalidatePath("/settings/notifications");
    return { id: template.id };
  });
}

export async function resendNotificationAction(
  notificationId: string,
): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.NOTIFICATION_MANAGE);
    const success = await resendNotification(notificationId);

    await recordAudit({
      userId: user.id,
      branchId: user.branchId,
      action: "NOTIFICATION_RESENT",
      entity: "Notification",
      entityId: notificationId,
      summary: success ? "Resent successfully" : "Resend failed",
    });

    revalidatePath("/settings/notifications");
    if (!success) throw new BusinessRuleError("The provider rejected the message");
    return null;
  });
}

export async function saveSettingsAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.SETTINGS_MANAGE);
    const firmId = requireFirmId(user);
    const input = settingSchema.parse(payload);

    const entries: { key: string; value: string; category: string }[] = [
      { key: "gst_rate", value: String(input.gstRate), category: "billing" },
      { key: "app_name", value: input.appName, category: "general" },
      {
        key: "default_turnaround_hours",
        value: String(input.defaultTurnaroundHours),
        category: "operations",
      },
      {
        key: "low_stock_alerts",
        value: String(input.lowStockAlerts),
        category: "inventory",
      },
      {
        key: "require_full_payment_before_delivery",
        value: String(input.requireFullPaymentBeforeDelivery),
        category: "billing",
      },
    ];

    await prisma.$transaction(
      entries.map((entry) =>
        prisma.setting.upsert({
          where: { firmId_key: { firmId, key: entry.key } },
          create: { ...entry, firmId },
          update: { value: entry.value },
        }),
      ),
    );

    await recordAudit({
      userId: user.id,
      branchId: user.branchId,
      action: "SETTINGS_UPDATED",
      entity: "Setting",
      summary: "System settings changed",
      after: input,
    });

    revalidatePath("/settings");
    return null;
  });
}

export async function createExpenseAction(
  payload: unknown,
): Promise<ActionResult<{ expenseNumber: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.EXPENSE_MANAGE);
    const input = expenseSchema.parse(payload);
    const branchId = await requireWriteBranch(user, input.branchId);

    const expense = await prisma.expense.create({
      data: {
        expenseNumber: await nextExpenseNumber(),
        branchId,
        firmId: requireFirmId(user),
        category: input.category,
        amount: input.amount,
        description: input.description,
        paidTo: input.paidTo ?? null,
        paymentMethod: input.paymentMethod,
        reference: input.reference ?? null,
        expenseDate: input.expenseDate,
        createdById: user.id,
      },
      select: { id: true, expenseNumber: true },
    });

    await recordAudit({
      userId: user.id,
      branchId,
      action: "EXPENSE_RECORDED",
      entity: "Expense",
      entityId: expense.id,
      summary: `${expense.expenseNumber} — ${formatCurrency(input.amount)} (${input.category})`,
    });

    revalidatePath("/settings/expenses");
    return { expenseNumber: expense.expenseNumber };
  });
}

export async function decideExpenseAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.EXPENSE_APPROVE);
    const input = expenseDecisionSchema.parse(payload);

    const expense = await prisma.expense.findUnique({
      where: { id: input.expenseId },
      select: { id: true, branchId: true, expenseNumber: true, status: true },
    });
    if (!expense) throw new NotFoundError("Expense not found");
    assertBranchAccess(user, expense.branchId);

    await prisma.expense.update({
      where: { id: expense.id },
      data: {
        status: input.status,
        approvedById: user.id,
        approvedAt: new Date(),
      },
    });

    await recordAudit({
      userId: user.id,
      branchId: expense.branchId,
      action: `EXPENSE_${input.status}`,
      entity: "Expense",
      entityId: expense.id,
      summary: `${expense.expenseNumber} ${input.status.toLowerCase()}`,
    });

    revalidatePath("/settings/expenses");
    return null;
  });
}


/**
 * Retiring a catalogue entry.
 *
 * A service or garment type that orders point at is never destroyed — doing so
 * would rewrite what those orders say they were for — so it is deactivated and
 * disappears from the pickers. Only an entry nothing has ever used is deleted.
 */
export async function archiveServiceAction(
  payload: unknown,
): Promise<ActionResult<{ deleted: boolean }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.CATALOGUE_MANAGE);
    const { id } = z.object({ id: cuidSchema }).parse(payload);

    const service = await prisma.service.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        firmId: true,
        isActive: true,
        _count: { select: { orderItems: true, garments: true, rates: true } },
      },
    });
    if (!service) throw new NotFoundError("Service not found");
    assertFirmAccess(user, service.firmId);

    const inUse = service._count.orderItems + service._count.garments > 0;

    if (inUse) {
      if (!service.isActive) throw new BusinessRuleError(`${service.name} is already retired`);
      await prisma.service.update({ where: { id }, data: { isActive: false } });
      await recordAudit({
        userId: user.id,
        action: "SERVICE_RETIRED",
        entity: "Service",
        entityId: id,
        summary: `${service.name} retired — ${service._count.orderItems} order lines kept`,
      });
      revalidatePath("/settings/catalogue");
      return { deleted: false };
    }

    await prisma.$transaction([
      prisma.serviceRate.deleteMany({ where: { serviceId: id } }),
      prisma.service.delete({ where: { id } }),
    ]);
    await recordAudit({
      userId: user.id,
      action: "SERVICE_DELETED",
      entity: "Service",
      entityId: id,
      summary: `${service.name} removed from the catalogue`,
    });
    revalidatePath("/settings/catalogue");
    return { deleted: true };
  });
}

/** Same rule as services: retire what is in use, delete what never was. */
export async function archiveGarmentTypeAction(
  payload: unknown,
): Promise<ActionResult<{ deleted: boolean }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.CATALOGUE_MANAGE);
    const { id } = z.object({ id: cuidSchema }).parse(payload);

    const type = await prisma.garmentType.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        firmId: true,
        isActive: true,
        _count: { select: { orderItems: true, garments: true } },
      },
    });
    if (!type) throw new NotFoundError("Garment type not found");
    assertFirmAccess(user, type.firmId);

    if (type._count.orderItems + type._count.garments > 0) {
      if (!type.isActive) throw new BusinessRuleError(`${type.name} is already retired`);
      await prisma.garmentType.update({ where: { id }, data: { isActive: false } });
      await recordAudit({
        userId: user.id,
        action: "GARMENT_TYPE_RETIRED",
        entity: "GarmentType",
        entityId: id,
        summary: `${type.name} retired`,
      });
      revalidatePath("/settings/catalogue");
      return { deleted: false };
    }

    await prisma.$transaction([
      prisma.serviceRate.deleteMany({ where: { garmentTypeId: id } }),
      prisma.garmentType.delete({ where: { id } }),
    ]);
    await recordAudit({
      userId: user.id,
      action: "GARMENT_TYPE_DELETED",
      entity: "GarmentType",
      entityId: id,
      summary: `${type.name} removed from the catalogue`,
    });
    revalidatePath("/settings/catalogue");
    return { deleted: true };
  });
}

/** Expenses can be withdrawn while nobody has acted on them. */
export async function deleteExpenseAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.EXPENSE_MANAGE);
    const { id } = z.object({ id: cuidSchema }).parse(payload);

    const expense = await prisma.expense.findUnique({
      where: { id },
      select: {
        id: true,
        expenseNumber: true,
        branchId: true,
        status: true,
        amount: true,
      },
    });
    if (!expense) throw new NotFoundError("Expense not found");
    assertBranchAccess(user, expense.branchId);

    if (expense.status !== "PENDING") {
      throw new BusinessRuleError(
        `${expense.expenseNumber} has already been ${expense.status.toLowerCase()} and stays on the books`,
      );
    }

    await prisma.expense.delete({ where: { id } });
    await recordAudit({
      userId: user.id,
      branchId: expense.branchId,
      action: "EXPENSE_DELETED",
      entity: "Expense",
      entityId: id,
      summary: `${expense.expenseNumber} withdrawn before approval`,
    });

    revalidatePath("/settings/expenses");
    revalidatePath("/reports");
    return null;
  });
}

/** Retiring a template stops it being used without losing what it has sent. */
export async function archiveTemplateAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.NOTIFICATION_MANAGE);
    const { id } = z.object({ id: cuidSchema }).parse(payload);

    const template = await prisma.notificationTemplate.findUnique({
      where: { id },
      select: { id: true, name: true, isActive: true },
    });
    if (!template) throw new NotFoundError("Template not found");

    await prisma.notificationTemplate.update({
      where: { id },
      data: { isActive: !template.isActive },
    });
    await recordAudit({
      userId: user.id,
      action: template.isActive ? "TEMPLATE_RETIRED" : "TEMPLATE_RESTORED",
      entity: "NotificationTemplate",
      entityId: id,
      summary: `${template.name} ${template.isActive ? "retired" : "restored"}`,
    });

    revalidatePath("/settings/notifications");
    return null;
  });
}
