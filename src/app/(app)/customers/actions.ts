"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/rbac";
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
import { nextCustomerCode } from "@/lib/sequence";
import {
  normalisePhone,
  searchCustomersForOrder,
} from "@/lib/services/customers";
import { cuidSchema } from "@/lib/validations/common";
import {
  createCustomerSchema,
  updateCustomerSchema,
} from "@/lib/validations/customer";

export async function createCustomerAction(
  payload: unknown,
): Promise<ActionResult<{ id: string; code: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.CUSTOMER_MANAGE);
    const input = createCustomerSchema.parse(payload);
    await requireWriteBranch(user, input.branchId);

    const phone = normalisePhone(input.phone);
    const clash = await prisma.customer.findFirst({
      where: { branchId: input.branchId, phone },
      select: { id: true, name: true },
    });
    if (clash) {
      throw new BusinessRuleError(
        `${clash.name} is already on file at this branch with that number`,
      );
    }

    const customer = await prisma.customer.create({
      data: {
        code: await nextCustomerCode(),
        branchId: input.branchId,
        firmId: requireFirmId(user),
        name: input.name,
        phone,
        email: input.email ?? null,
        addressLine: input.addressLine ?? null,
        city: input.city ?? null,
        pincode: input.pincode ?? null,
        landmark: input.landmark ?? null,
        notes: input.notes ?? null,
        createdById: user.id,
      },
      select: { id: true, code: true },
    });

    await recordAudit({
      userId: user.id,
      branchId: input.branchId,
      action: "CUSTOMER_CREATED",
      entity: "Customer",
      entityId: customer.id,
      summary: `${input.name} (${phone}) added to the directory`,
    });

    revalidatePath("/customers");
    return customer;
  });
}

export async function updateCustomerAction(payload: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.CUSTOMER_MANAGE);
    const input = updateCustomerSchema.parse(payload);

    const customer = await prisma.customer.findUnique({
      where: { id: input.customerId },
      select: { id: true, branchId: true, firmId: true, name: true, phone: true },
    });
    if (!customer) throw new NotFoundError("Customer not found");
    assertBranchAccess(user, customer.branchId);
    assertFirmAccess(user, customer.firmId);

    const phone = normalisePhone(input.phone);
    if (phone !== customer.phone) {
      const clash = await prisma.customer.findFirst({
        where: { branchId: customer.branchId, phone, id: { not: customer.id } },
        select: { name: true },
      });
      if (clash) {
        throw new BusinessRuleError(
          `${clash.name} already holds that number at this branch`,
        );
      }
    }

    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        name: input.name,
        phone,
        email: input.email ?? null,
        addressLine: input.addressLine ?? null,
        city: input.city ?? null,
        pincode: input.pincode ?? null,
        landmark: input.landmark ?? null,
        notes: input.notes ?? null,
        isActive: input.isActive,
      },
    });

    await recordAudit({
      userId: user.id,
      branchId: customer.branchId,
      action: "CUSTOMER_UPDATED",
      entity: "Customer",
      entityId: customer.id,
      summary: `${customer.name} updated`,
      before: { name: customer.name, phone: customer.phone },
      after: { name: input.name, phone },
    });

    revalidatePath("/customers");
    revalidatePath(`/customers/${customer.id}`);
    return null;
  });
}

/**
 * Removing a customer from the directory.
 *
 * A customer with orders is never destroyed — their orders carry the billing
 * snapshot and deleting the row would orphan history — so they are retired
 * instead, which takes them out of the pickers while leaving every order
 * intact. Only a record that has never been used is actually deleted.
 */
export async function deleteCustomerAction(
  payload: unknown,
): Promise<ActionResult<{ deleted: boolean }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.CUSTOMER_MANAGE);
    const { customerId } = z.object({ customerId: cuidSchema }).parse(payload);

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        phone: true,
        branchId: true,
        firmId: true,
        isActive: true,
        _count: { select: { orders: true } },
      },
    });
    if (!customer) throw new NotFoundError("Customer not found");
    assertBranchAccess(user, customer.branchId);
    assertFirmAccess(user, customer.firmId);

    if (customer._count.orders > 0) {
      if (!customer.isActive) {
        throw new BusinessRuleError(`${customer.name} is already retired`);
      }
      await prisma.customer.update({
        where: { id: customer.id },
        data: { isActive: false },
      });
      await recordAudit({
        userId: user.id,
        branchId: customer.branchId,
        action: "CUSTOMER_RETIRED",
        entity: "Customer",
        entityId: customer.id,
        summary: `${customer.name} retired — ${customer._count.orders} orders kept`,
      });
      revalidatePath("/customers");
      revalidatePath(`/customers/${customer.id}`);
      return { deleted: false };
    }

    await prisma.customer.delete({ where: { id: customer.id } });
    await recordAudit({
      userId: user.id,
      branchId: customer.branchId,
      action: "CUSTOMER_DELETED",
      entity: "Customer",
      entityId: customer.id,
      summary: `${customer.name} (${customer.phone}) removed from the directory`,
    });

    revalidatePath("/customers");
    return { deleted: true };
  });
}

/** Type-ahead for the order form's customer picker. */
export async function findCustomersAction(payload: unknown) {
  return runAction(async () => {
    const user = await authorize([PERMISSIONS.CUSTOMER_VIEW, PERMISSIONS.ORDER_CREATE]);
    const { query } = z.object({ query: z.string().trim().max(80) }).parse(payload);

    return searchCustomersForOrder({
      firmId: requireFirmId(user),
      branchIds: hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES)
        ? null
        : user.branchId
          ? [user.branchId]
          : [],
      query,
    });
  });
}
