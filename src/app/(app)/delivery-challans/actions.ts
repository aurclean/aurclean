"use server";

import { revalidatePath } from "next/cache";
import { requireFirmId, requirePermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import {
  createDeliveryChallan,
  updateChallanStatus,
  cancelDeliveryChallan,
} from "@/lib/services/delivery-challan";
import type { ChallanStatus, PaymentMethod } from "@/generated/prisma/client";

export async function createDeliveryChallanAction(data: {
  orderId: string;
  notes?: string;
  terms?: string;
  deliveredByName?: string;
  receivedByName?: string;
  garmentIds?: string[];
}) {
  const session = await requirePermission(PERMISSIONS.DELIVERY_MANAGE);

  try {
    const challan = await createDeliveryChallan({
      ...data,
      userId: session.id,
      userBranchId: session.branchId || undefined,
      firmId: requireFirmId(session),
    });

    revalidatePath("/delivery-challans");
    revalidatePath(`/delivery-challans/${challan.id}`);
    revalidatePath(`/orders/${data.orderId}`);
    if (challan.customerId) {
      revalidatePath(`/customers/${challan.customerId}`);
    }

    return {
      success: true,
      id: challan.id,
      challanNumber: challan.challanNumber,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Failed to create Delivery Challan",
    };
  }
}

export async function updateChallanStatusAction(
  id: string,
  toStatus: ChallanStatus,
  options: {
    note?: string;
    deliveredByName?: string;
    receivedByName?: string;
    paymentAmount?: number;
    paymentMethod?: PaymentMethod;
  } = {},
) {
  const session = await requirePermission(PERMISSIONS.DELIVERY_MANAGE);

  try {
    const updated = await updateChallanStatus(id, toStatus, {
      ...options,
      userId: session.id,
      firmId: requireFirmId(session),
    });

    revalidatePath("/delivery-challans");
    revalidatePath(`/delivery-challans/${id}`);
    revalidatePath(`/orders/${updated.orderId}`);
    if (updated.customerId) {
      revalidatePath(`/customers/${updated.customerId}`);
    }

    return {
      success: true,
      status: updated.status,
      challanNumber: updated.challanNumber,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Failed to update Delivery Challan status",
    };
  }
}

export async function cancelChallanAction(id: string, reason: string) {
  const session = await requirePermission(PERMISSIONS.DELIVERY_MANAGE);

  try {
    const updated = await cancelDeliveryChallan(id, reason, session.id, requireFirmId(session));

    revalidatePath("/delivery-challans");
    revalidatePath(`/delivery-challans/${id}`);
    revalidatePath(`/orders/${updated.orderId}`);

    return {
      success: true,
      status: updated.status,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Failed to cancel Delivery Challan",
    };
  }
}

