import type { TrackingCategory } from "@/generated/prisma/enums";

export interface CategoryMeta {
  value: TrackingCategory;
  label: string;
  /** Two-letter prefix on every garment id in this category, e.g. TR-1042. */
  prefix: string;
  emoji: string;
  /** Words an operator might type when they mean this category. */
  aliases: string[];
}

/**
 * The buckets the floor counts in. The order here is the order they appear on
 * the dashboard, so it runs from the highest-volume category downwards.
 */
export const GARMENT_CATEGORIES: CategoryMeta[] = [
  {
    value: "TROUSERS",
    label: "Trousers",
    prefix: "TR",
    emoji: "👖",
    aliases: ["trouser", "trousers", "pant", "pants", "jeans", "bottoms"],
  },
  {
    value: "SHIRTS",
    label: "Shirts",
    prefix: "SH",
    emoji: "👕",
    aliases: ["shirt", "shirts", "formal shirt"],
  },
  {
    value: "TSHIRTS",
    label: "T-Shirts",
    prefix: "TS",
    emoji: "👔",
    aliases: ["tshirt", "t-shirt", "tshirts", "t shirts", "tee", "tees"],
  },
  {
    value: "JACKETS",
    label: "Jackets",
    prefix: "JK",
    emoji: "🧥",
    aliases: ["jacket", "jackets", "coat", "blazer", "suit", "outerwear"],
  },
  {
    value: "DRESSES",
    label: "Dresses",
    prefix: "DR",
    emoji: "👗",
    aliases: ["dress", "dresses", "gown", "frock"],
  },
  {
    value: "SAREES",
    label: "Sarees",
    prefix: "SR",
    emoji: "🧣",
    aliases: ["saree", "sarees", "sari", "kurta", "ethnic"],
  },
  {
    value: "BEDSHEETS",
    label: "Bedsheets",
    prefix: "BS",
    emoji: "🛏️",
    aliases: ["bedsheet", "bedsheets", "bed sheet", "linen", "sheet"],
  },
  {
    value: "OTHER",
    label: "Other",
    prefix: "OT",
    emoji: "🧺",
    aliases: ["other", "misc", "towel", "curtain", "pillow"],
  },
];

export const CATEGORY_BY_VALUE = new Map(
  GARMENT_CATEGORIES.map((entry) => [entry.value, entry]),
);

export const CATEGORY_BY_PREFIX = new Map(
  GARMENT_CATEGORIES.map((entry) => [entry.prefix, entry]),
);

export function categoryMeta(value: TrackingCategory): CategoryMeta {
  return CATEGORY_BY_VALUE.get(value) ?? GARMENT_CATEGORIES[GARMENT_CATEGORIES.length - 1];
}

export function categoryLabel(value: TrackingCategory): string {
  return categoryMeta(value).label;
}

export function categoryPrefix(value: TrackingCategory): string {
  return categoryMeta(value).prefix;
}

/** Accepts a slug from a URL, a prefix off a tag, or whatever was typed. */
export function parseCategory(raw: string | null | undefined): TrackingCategory | null {
  if (!raw) return null;
  const input = raw.trim().toLowerCase();
  if (!input) return null;

  for (const entry of GARMENT_CATEGORIES) {
    if (
      input === entry.value.toLowerCase() ||
      input === entry.label.toLowerCase() ||
      input === entry.prefix.toLowerCase() ||
      entry.aliases.includes(input)
    ) {
      return entry.value;
    }
  }
  return null;
}

/** URL slug for a category — the lower-cased enum value. */
export function categorySlug(value: TrackingCategory): string {
  return value.toLowerCase();
}

/**
 * Garment type code → tracking bucket. Anything the catalogue adds later falls
 * to OTHER until someone classifies it on the catalogue screen.
 */
export const TYPE_CODE_CATEGORY: Record<string, TrackingCategory> = {
  PANT: "TROUSERS",
  JEANS: "TROUSERS",
  SHIRT: "SHIRTS",
  TSHIRT: "TSHIRTS",
  JACKET: "JACKETS",
  BLAZER: "JACKETS",
  SUIT: "JACKETS",
  DRESS: "DRESSES",
  SAREE: "SAREES",
  KURTA: "SAREES",
  BEDSHEET: "BEDSHEETS",
  PILLOWCOVER: "BEDSHEETS",
  TOWEL: "OTHER",
  CURTAIN: "OTHER",
};

export function categoryForTypeCode(code: string): TrackingCategory {
  return TYPE_CODE_CATEGORY[code.toUpperCase()] ?? "OTHER";
}
