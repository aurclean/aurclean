/**
 * Generates a clean uppercase service code from a service name
 * (e.g. "Dry Clean" -> "DRY-CLEAN", "Wash & Fold" -> "WASH-FOLD").
 * Enforces the 20-character schema limit and falls back to "SVC" when
 * the name contains no ASCII alphanumeric characters.
 */
export function generateServiceCode(name: string, suffix?: string): string {
  const base = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const cleanBase = base.length >= 2 ? base : base.length === 1 ? `${base}-SVC` : "SVC";
  if (!suffix) {
    return cleanBase.slice(0, 20).replace(/-+$/, "") || "SVC";
  }

  const cleanSuffix = `-${suffix}`;
  const maxBaseLen = Math.max(1, 20 - cleanSuffix.length);
  const trimmedBase = cleanBase.slice(0, maxBaseLen).replace(/-+$/, "") || "SVC";
  return `${trimmedBase}${cleanSuffix}`.slice(0, 20);
}
