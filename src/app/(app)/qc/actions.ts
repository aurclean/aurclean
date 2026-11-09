"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { PERMISSIONS } from "@/lib/rbac";
import { authorize } from "@/lib/session";
import { runAction, type ActionResult } from "@/lib/action-result";
import { cuidSchema } from "@/lib/validations/common";
import { recordQcDecision } from "@/lib/services/qc";

const schema = z.object({
  garmentId: cuidSchema,
  decision: z.enum(["PASS", "FAIL", "REWORK"]),
  notes: z.string().trim().max(500).optional(),
});

/** The firm is taken from the session inside recordQcDecision — it is never a parameter. */
export async function qcDecisionAction(payload: unknown): Promise<ActionResult<{ garmentCode: string; result: string }>> {
  return runAction(async () => {
    const user = await authorize(PERMISSIONS.QC_PERFORM);
    const input = schema.parse(payload);
    const outcome = await recordQcDecision(user, input);
    revalidatePath("/qc");
    revalidatePath("/qc/passed");
    revalidatePath("/qc/failed");
    return outcome;
  });
}
