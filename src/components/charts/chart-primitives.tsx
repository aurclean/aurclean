"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared chart chrome. Every chart in the app sits inside this frame so titles,
 * legends and table fallbacks are consistent — identity is never carried by
 * colour alone.
 */
export function ChartFrame({
  title,
  description,
  legend,
  children,
  footer,
  className,
}: {
  title: string;
  description?: string;
  legend?: { label: string; color: string }[];
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <figure
      className={cn(
        "rounded-xl border border-border bg-card p-4",
        className,
      )}
    >
      <figcaption className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {legend && legend.length > 1 ? (
          <ul className="flex flex-wrap items-center gap-3">
            {legend.map((entry) => (
              <li
                key={entry.label}
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <span
                  className="size-2.5 rounded-sm"
                  style={{ backgroundColor: entry.color }}
                  aria-hidden
                />
                {entry.label}
              </li>
            ))}
          </ul>
        ) : null}
      </figcaption>
      {children}
      {footer ? <div className="mt-3">{footer}</div> : null}
    </figure>
  );
}

export const CHART_COLORS = {
  series1: "var(--chart-1)",
  series2: "var(--chart-2)",
  series3: "var(--chart-3)",
  series4: "var(--chart-4)",
  grid: "var(--chart-grid)",
  surface: "var(--chart-surface)",
  text: "var(--muted-foreground)",
} as const;

export const AXIS_PROPS = {
  tick: { fontSize: 11, fill: "var(--muted-foreground)" },
  tickLine: false,
  axisLine: false,
} as const;

/** Shared tooltip shell — values in text tokens, a colour chip for identity. */
export function TooltipCard({
  label,
  rows,
}: {
  label: string;
  rows: { name: string; value: string; color?: string }[];
}) {
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-md">
      <p className="mb-1 text-xs font-medium text-foreground">{label}</p>
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={row.name} className="flex items-center gap-2 text-xs">
            {row.color ? (
              <span
                className="size-2 rounded-sm"
                style={{ backgroundColor: row.color }}
                aria-hidden
              />
            ) : null}
            <span className="text-muted-foreground">{row.name}</span>
            <span className="ml-auto font-medium text-foreground numeric">
              {row.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Accessible table fallback, required wherever a mark sits below 3:1 contrast. */
export function ChartTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: (string | number)[][];
}) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
        View as table
      </summary>
      <div className="mt-2 max-h-64 overflow-auto scrollbar-thin">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              {columns.map((column, index) => (
                <th
                  key={column}
                  className={cn("py-1.5 pr-3 font-medium", index > 0 && "text-right")}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-border last:border-0">
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={cn(
                      "py-1.5 pr-3",
                      cellIndex > 0 && "text-right numeric",
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
