/**
 * Prisma returns Decimal instances, which React Server Components cannot pass
 * across the server/client boundary. `plain` deep-converts a query result into
 * transferable primitives.
 */
type Decimalish = { toNumber: () => number; toFixed: (dp?: number) => string };

function isDecimal(value: unknown): value is Decimalish {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Decimalish).toNumber === "function" &&
    typeof (value as Decimalish).toFixed === "function"
  );
}

export type Plain<T> = T extends Decimalish
  ? number
  : T extends Date
    ? Date
    : T extends Array<infer U>
      ? Plain<U>[]
      : T extends object
        ? { [K in keyof T]: Plain<T[K]> }
        : T;

export function plain<T>(value: T): Plain<T> {
  if (value === null || value === undefined) return value as Plain<T>;
  if (value instanceof Date) return value as Plain<T>;
  if (isDecimal(value)) return value.toNumber() as Plain<T>;
  if (Array.isArray(value)) return value.map(plain) as Plain<T>;
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = plain(val);
    }
    return result as Plain<T>;
  }
  return value as Plain<T>;
}
