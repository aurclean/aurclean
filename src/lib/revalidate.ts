import "server-only";
import { revalidatePath } from "next/cache";

/**
 * The screens that show live shop-floor state. Any action that moves a garment,
 * changes an order or takes money touches several of these at once, and an
 * operator with the dashboard open on one screen and a station on another
 * expects both to agree — so the set is revalidated together rather than each
 * action trying to remember which screens it affects.
 */
const OPERATIONAL_PATHS = [
  "/dashboard",
  "/orders",
  "/processing",
  "/tracking",
  "/mismatch",
  "/garments",
  "/scan",
] as const;

const MONEY_PATHS = ["/billing", "/customers", "/reports"] as const;

export function revalidateOperational(extra: string[] = []): void {
  for (const path of [...OPERATIONAL_PATHS, ...extra]) revalidatePath(path);
}

export function revalidateMoney(extra: string[] = []): void {
  for (const path of [...MONEY_PATHS, "/dashboard", ...extra]) {
    revalidatePath(path);
  }
}
