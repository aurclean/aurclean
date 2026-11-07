"use server";

import { z } from "zod";

import { revalidateOperational } from "@/lib/revalidate";

import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { PERMISSIONS, STAGE_PERMISSION } from "@/lib/rbac";
import { assertFirmAccess, authorize, hasPermission, requireFirmId } from "@/lib/session";
import {
  BusinessRuleError,
  NotFoundError,
  runAction,
  type ActionResult,
} from "@/lib/action-result";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { advanceGarment } from "@/lib/services/processing";
import {
  listScanHistory,
  logScan,
  resolveGarmentScan,
  type ScanHistoryRow,
  type ScanResult,
} from "@/lib/services/scanning";

const scanSchema = z.object({
  code: z.string().trim().min(1, "Scan or type a code").max(200),
  source: z.enum(["KEYBOARD", "CAMERA", "HARDWARE"]).default("KEYBOARD"),
  contextOrderId: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional(),
});

/**
 * The single endpoint behind the scan workspace. Every read is logged —
 * including the ones that fail — because a stream of "tag not found" from one
 * scanner is a support question, and the history is the answer.
 */
export async function scanGarmentAction(payload: unknown): Promise<ActionResult<ScanResult>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.GARMENT_SCAN);

    const limit = rateLimit(`scan:${user.id}`, RATE_LIMITS.SCAN.limit, RATE_LIMITS.SCAN.windowMs);
    if (!limit.success) throw new BusinessRuleError("Scanning too fast — slow down a moment");

    const input = scanSchema.parse(payload);
    const hasAllBranches = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES);
    const branchIds = hasAllBranches ? null : user.branchId ? [user.branchId] : [];

    // A branch-scoped operator must actually have a branch. A firm-wide
    // admin with no fixed branch of their own is fine — the scan is
    // attributed to whichever branch the garment itself belongs to.
    if (!user.branchId && !hasAllBranches) {
      throw new BusinessRuleError("Your account is not assigned to a branch");
    }

    const result = await resolveGarmentScan({
      rawCode: input.code,
      contextOrderId: input.contextOrderId ?? null,
      branchIds,
      branchId: user.branchId,
      firmId: requireFirmId(user),
      userId: user.id,
    });

    await logScan({
      branchId: user.branchId,
      firmId: requireFirmId(user),
      rawCode: input.code,
      result,
      source: input.source,
      userId: user.id,
    });

    if (result.kind === "FOUND") revalidateOperational();

    return result;
  });
}

export async function scanHistoryAction(
  payload: unknown,
): Promise<ActionResult<ScanHistoryRow[]>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.GARMENT_SCAN);
    const input = z
      .object({
        search: z.string().trim().max(120).optional(),
      })
      .parse(payload ?? {});

    return listScanHistory({
      firmId: requireFirmId(user),
      branchIds: hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES)
        ? null
        : user.branchId
          ? [user.branchId]
          : [],
      search: input.search,
      limit: 40,
    });
  });
}

const updateStatusSchema = z.object({
  garmentId: z.string().trim().min(1),
});

/**
 * One tap from the result panel: clears the garment's current station and
 * moves it to the next one on its own route.
 */
export async function scanUpdateStatusAction(
  payload: unknown,
): Promise<ActionResult<{ status: string; nextStage: string | null }>> {
  return runAction(async () => {
    const input = updateStatusSchema.parse(payload);

    const garment = await prisma.garment.findUnique({
      where: { id: input.garmentId },
      select: { id: true, garmentCode: true, currentStage: true, branchId: true, firmId: true },
    });
    if (!garment) throw new NotFoundError("Garment not found");

    const required = STAGE_PERMISSION[garment.currentStage] ?? PERMISSIONS.PROCESSING_VIEW;
    const user = await authorize(required);
    assertFirmAccess(user, garment.firmId);

    // A firm-wide admin with no fixed branch acts on whichever branch the
    // garment itself belongs to, same as the scan action above.
    const actingBranchId = user.branchId ?? garment.branchId;

    const result = await advanceGarment({
      garmentId: garment.id,
      stage: garment.currentStage,
      outcome: "COMPLETED",
      scannedVia: "scan-workspace",
      actor: { userId: user.id, userName: user.name, branchId: actingBranchId, firmId: garment.firmId },
    });

    await recordAudit({
      userId: user.id,
      branchId: actingBranchId,
      action: "GARMENT_STAGE_ADVANCED",
      entity: "Garment",
      entityId: garment.id,
      summary: `${result.garmentCode} → ${result.status} (scan workspace)`,
    });

    revalidateOperational([`/garments/${result.garmentCode}`]);
    return { status: result.status, nextStage: result.nextStage };
  });
}
