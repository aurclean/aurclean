"use server";

import { z } from "zod";
import { authorize, hasPermission, requireFirmId } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import { runAction, type ActionResult, BusinessRuleError } from "@/lib/action-result";
import { recordAudit } from "@/lib/audit";
import {
  validateBatchScan,
  fetchExpectedGarments,
  type BatchScanItemResult,
  type ExpectedGarment,
} from "@/lib/services/batch-scanning";

const batchScanSchema = z.object({
  code: z.string().trim().min(1, "Scan or type a code").max(200),
  operation: z.string().nullable().optional(),
  contextOrderId: z.string().nullable().optional(),
  contextCustomerId: z.string().nullable().optional(),
  autoAdvance: z.boolean().default(true),
  alreadyScannedCodes: z.array(z.string()).optional(),
});

export async function batchScanGarmentAction(
  payload: unknown,
): Promise<ActionResult<BatchScanItemResult>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.GARMENT_SCAN);
    const hasAllBranches = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES);
    if (!user.branchId && !hasAllBranches) {
      throw new BusinessRuleError("Your account is not assigned to a branch");
    }

    const input = batchScanSchema.parse(payload);

    const result = await validateBatchScan({
      rawCode: input.code,
      operation: input.operation,
      contextOrderId: input.contextOrderId,
      contextCustomerId: input.contextCustomerId,
      autoAdvance: input.autoAdvance,
      alreadyScannedCodes: input.alreadyScannedCodes,
      branchIds: hasAllBranches ? null : [user.branchId!],
      firmId: requireFirmId(user),
      userId: user.id,
    });

    if (result.outcome === "MISMATCH" || result.outcome === "UNKNOWN") {
      await recordAudit({
        userId: user.id,
        branchId: user.branchId,
        firmId: requireFirmId(user),
        action: "BATCH_SCAN_EXCEPTION",
        entity: "BatchScan",
        summary: `Batch scan exception [${result.outcome}]: ${input.code} — ${result.message}`,
      });
    }

    return result;
  });
}

const fetchExpectedSchema = z.object({
  orderId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
});

export async function fetchBatchExpectedGarmentsAction(
  payload: unknown,
): Promise<ActionResult<ExpectedGarment[]>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.GARMENT_SCAN);
    const hasAllBranches = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES);
    if (!user.branchId && !hasAllBranches) {
      throw new BusinessRuleError("Your account is not assigned to a branch");
    }

    const input = fetchExpectedSchema.parse(payload ?? {});
    return fetchExpectedGarments({
      orderId: input.orderId,
      customerId: input.customerId,
      branchIds: hasAllBranches ? null : [user.branchId!],
      firmId: requireFirmId(user),
    });
  });
}
