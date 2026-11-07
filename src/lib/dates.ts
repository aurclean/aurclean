import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  formatDistanceToNowStrict,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
} from "date-fns";

export const DATE_FORMAT = "dd MMM yyyy";
export const DATETIME_FORMAT = "dd MMM yyyy, h:mm a";
export const TIME_FORMAT = "h:mm a";

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return format(new Date(value), DATE_FORMAT);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return format(new Date(value), DATETIME_FORMAT);
}

export function formatTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return format(new Date(value), TIME_FORMAT);
}

export function formatRelative(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return `${formatDistanceToNowStrict(new Date(value))} ago`;
}

export function toInputDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  return format(new Date(value), "yyyy-MM-dd");
}

export function toInputDateTime(value: Date | string | null | undefined): string {
  if (!value) return "";
  return format(new Date(value), "yyyy-MM-dd'T'HH:mm");
}

export type DateRangePreset =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "this_week"
  | "this_month"
  | "all";

export interface DateRange {
  from: Date;
  to: Date;
}

export function resolveDateRange(
  preset: DateRangePreset | undefined,
  fromParam?: string,
  toParam?: string,
): DateRange | undefined {
  if (fromParam || toParam) {
    const from = fromParam ? startOfDay(new Date(fromParam)) : startOfDay(subDays(new Date(), 30));
    const to = toParam ? endOfDay(new Date(toParam)) : endOfDay(new Date());
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return undefined;
    return { from, to };
  }

  const now = new Date();
  switch (preset) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "yesterday": {
      const y = subDays(now, 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case "last7":
      return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
    case "last30":
      return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
    case "this_week":
      return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
    case "this_month":
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case "all":
      return undefined;
    default:
      return undefined;
  }
}

export const DATE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "this_week", label: "This week" },
  { value: "this_month", label: "This month" },
  { value: "all", label: "All time" },
];

export function todayRange(): DateRange {
  const now = new Date();
  return { from: startOfDay(now), to: endOfDay(now) };
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

/** Turnaround time in hours between two timestamps. */
export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (1000 * 60 * 60);
}
