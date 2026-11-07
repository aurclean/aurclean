"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
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
import { formatCompactCurrency, formatCurrency } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export interface SeriesPoint {
  date: string;
  orders: number;
  revenue: number;
}

/**
 * Revenue over time — a single series, so no legend box; the title names it.
 * Order volume lives in its own chart rather than sharing a second y-axis.
 */
export function RevenueChart({ data }: { data: SeriesPoint[] }) {
  const total = data.reduce((sum, point) => sum + point.revenue, 0);

  return (
    <ChartFrame
      title="Revenue"
      description={`${formatCurrency(total)} booked across the selected period`}
      footer={
        <ChartTable
          columns={["Date", "Revenue"]}
          rows={data.map((point) => [
            formatDate(point.date),
            formatCurrency(point.revenue),
          ])}
        />
      }
    >
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.series1} stopOpacity={0.28} />
                <stop offset="100%" stopColor={CHART_COLORS.series1} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid
              stroke={CHART_COLORS.grid}
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              {...AXIS_PROPS}
              tickFormatter={(value: string) =>
                new Date(value).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                })
              }
              minTickGap={24}
            />
            <YAxis
              {...AXIS_PROPS}
              width={52}
              tickFormatter={(value: number) => formatCompactCurrency(value)}
            />
            <Tooltip
              cursor={{ stroke: CHART_COLORS.grid, strokeWidth: 1 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipCard
                    label={formatDate(String(label))}
                    rows={[
                      {
                        name: "Revenue",
                        value: formatCurrency(Number(payload[0].value)),
                        color: CHART_COLORS.series1,
                      },
                    ]}
                  />
                ) : null
              }
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke={CHART_COLORS.series1}
              strokeWidth={2}
              fill="url(#revenueFill)"
              activeDot={{ r: 4, strokeWidth: 2, stroke: CHART_COLORS.surface }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}

/** Order volume — counts, so it gets its own axis and its own chart. */
export function OrderVolumeChart({ data }: { data: SeriesPoint[] }) {
  const total = data.reduce((sum, point) => sum + point.orders, 0);

  return (
    <ChartFrame
      title="Order volume"
      description={`${total.toLocaleString("en-IN")} orders booked across the selected period`}
      footer={
        <ChartTable
          columns={["Date", "Orders"]}
          rows={data.map((point) => [formatDate(point.date), point.orders])}
        />
      }
    >
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="ordersFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.series2} stopOpacity={0.26} />
                <stop offset="100%" stopColor={CHART_COLORS.series2} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid
              stroke={CHART_COLORS.grid}
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              {...AXIS_PROPS}
              tickFormatter={(value: string) =>
                new Date(value).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                })
              }
              minTickGap={24}
            />
            <YAxis {...AXIS_PROPS} width={36} allowDecimals={false} />
            <Tooltip
              cursor={{ stroke: CHART_COLORS.grid, strokeWidth: 1 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipCard
                    label={formatDate(String(label))}
                    rows={[
                      {
                        name: "Orders",
                        value: String(payload[0].value),
                        color: CHART_COLORS.series2,
                      },
                    ]}
                  />
                ) : null
              }
            />
            <Area
              type="monotone"
              dataKey="orders"
              stroke={CHART_COLORS.series2}
              strokeWidth={2}
              fill="url(#ordersFill)"
              activeDot={{ r: 4, strokeWidth: 2, stroke: CHART_COLORS.surface }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
