"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  AXIS_PROPS,
  CHART_COLORS,
  ChartFrame,
  ChartTable,
  TooltipCard,
} from "@/components/charts/chart-primitives";
import { formatCurrency } from "@/lib/money";
import { humanize } from "@/lib/utils";

/**
 * Server Components cannot hand a formatter function across the boundary, so
 * the caller names the format and the client resolves it.
 */
export type ValueFormat = "number" | "currency";

const FORMATTERS: Record<ValueFormat, (value: number) => string> = {
  number: (value) => value.toLocaleString("en-IN"),
  currency: (value) => formatCurrency(value),
};

export interface CategoryDatum {
  name: string;
  value: number;
  /** Optional secondary figure shown in the tooltip and table. */
  secondary?: { label: string; value: string };
}

/**
 * Horizontal bars for nominal categories — one series, one colour. Length
 * already encodes magnitude, so hue is not spent on it a second time.
 */
export function CategoryBarChart({
  title,
  description,
  data,
  valueLabel,
  format = "number",
  humanizeNames = true,
  color = CHART_COLORS.series1,
}: {
  title: string;
  description?: string;
  data: CategoryDatum[];
  valueLabel: string;
  format?: ValueFormat;
  humanizeNames?: boolean;
  color?: string;
}) {
  const formatValue = FORMATTERS[format];
  const prepared = data.map((entry) => ({
    ...entry,
    label: humanizeNames ? humanize(entry.name) : entry.name,
  }));

  if (prepared.length === 0) {
    return (
      <ChartFrame title={title} description={description}>
        <p className="py-10 text-center text-sm text-muted-foreground">
          No data in this period.
        </p>
      </ChartFrame>
    );
  }

  return (
    <ChartFrame
      title={title}
      description={description}
      footer={
        <ChartTable
          columns={[
            "Category",
            valueLabel,
            ...(prepared[0].secondary ? [prepared[0].secondary.label] : []),
          ]}
          rows={prepared.map((entry) => [
            entry.label,
            formatValue(entry.value),
            ...(entry.secondary ? [entry.secondary.value] : []),
          ])}
        />
      }
    >
      <div style={{ height: Math.max(160, prepared.length * 34 + 24) }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={prepared}
            layout="vertical"
            margin={{ top: 0, right: 56, left: 0, bottom: 0 }}
            barCategoryGap={6}
          >
            <CartesianGrid
              stroke={CHART_COLORS.grid}
              strokeDasharray="3 3"
              horizontal={false}
            />
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="label"
              {...AXIS_PROPS}
              width={132}
              interval={0}
            />
            <Tooltip
              cursor={{ fill: CHART_COLORS.grid, fillOpacity: 0.35 }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TooltipCard
                    label={String(payload[0].payload.label)}
                    rows={[
                      {
                        name: valueLabel,
                        value: formatValue(Number(payload[0].value)),
                        color,
                      },
                      ...(payload[0].payload.secondary
                        ? [
                            {
                              name: payload[0].payload.secondary.label,
                              value: payload[0].payload.secondary.value,
                            },
                          ]
                        : []),
                    ]}
                  />
                ) : null
              }
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
              {prepared.map((entry) => (
                <Cell key={entry.name} fill={color} />
              ))}
              <LabelList
                dataKey="value"
                position="right"
                formatter={(value: unknown) => formatValue(Number(value ?? 0))}
                style={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
