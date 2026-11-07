"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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
import { STAGE_LABELS } from "@/lib/workflow";
import type { ProcessingStage } from "@/generated/prisma/enums";

export interface PipelineDatum {
  stage: string;
  pending: number;
  inProgress: number;
}

/**
 * Work waiting at each station. Two series, so a legend is present and the
 * stacked segments carry a 2px surface gap between them.
 */
export function PipelineChart({ data }: { data: PipelineDatum[] }) {
  const prepared = data.map((entry) => ({
    ...entry,
    label: STAGE_LABELS[entry.stage as ProcessingStage] ?? entry.stage,
  }));

  if (prepared.length === 0) {
    return (
      <ChartFrame title="Work in progress" description="Queue depth by station">
        <p className="py-10 text-center text-sm text-muted-foreground">
          Every station is clear.
        </p>
      </ChartFrame>
    );
  }

  return (
    <ChartFrame
      title="Work in progress"
      description="Garments waiting at each station"
      legend={[
        { label: "Waiting", color: CHART_COLORS.series1 },
        { label: "In progress", color: CHART_COLORS.series2 },
      ]}
      footer={
        <ChartTable
          columns={["Station", "Waiting", "In progress"]}
          rows={prepared.map((entry) => [entry.label, entry.pending, entry.inProgress])}
        />
      }
    >
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={prepared}
            margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
            barCategoryGap={12}
          >
            <CartesianGrid
              stroke={CHART_COLORS.grid}
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis dataKey="label" {...AXIS_PROPS} interval={0} />
            <YAxis {...AXIS_PROPS} width={36} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: CHART_COLORS.grid, fillOpacity: 0.35 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipCard
                    label={String(label)}
                    rows={payload.map((entry) => ({
                      name: entry.name === "pending" ? "Waiting" : "In progress",
                      value: String(entry.value),
                      color: String(entry.color),
                    }))}
                  />
                ) : null
              }
            />
            <Legend content={() => null} />
            <Bar
              dataKey="pending"
              stackId="queue"
              fill={CHART_COLORS.series1}
              barSize={26}
              stroke={CHART_COLORS.surface}
              strokeWidth={2}
            />
            <Bar
              dataKey="inProgress"
              stackId="queue"
              fill={CHART_COLORS.series2}
              barSize={26}
              radius={[4, 4, 0, 0]}
              stroke={CHART_COLORS.surface}
              strokeWidth={2}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
