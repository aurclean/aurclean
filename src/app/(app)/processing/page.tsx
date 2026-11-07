import Link from "next/link";
import { ArrowRight, Package } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS, STAGE_PERMISSION } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { STAGE_LABELS, WORKSTATION_STAGES } from "@/lib/workflow";
import { scopedBranchId, type SearchParams } from "@/lib/queries/filters";
import type { PermissionCode } from "@/lib/rbac";
import type { ProcessingStage } from "@/generated/prisma/enums";

export const metadata = { title: "Processing" };

const stageSlug = (stage: ProcessingStage) =>
  stage.toLowerCase().replace(/_/g, "-");

export default async function ProcessingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requirePermission(PERMISSIONS.PROCESSING_VIEW);
  const branchId = scopedBranchId(user, params);
  const firmId = requireFirmId(user);

  const grouped = await prisma.processingTask.groupBy({
    by: ["stage", "status"],
    where: { branch: { firmId }, ...(branchId ? { branchId } : {}) },
    _count: { _all: true },
  });

  const counts = new Map<string, Record<string, number>>();
  for (const row of grouped) {
    const entry = counts.get(row.stage) ?? {};
    entry[row.status] = row._count._all;
    counts.set(row.stage, entry);
  }

  const totalPending = grouped
    .filter((row) => row.status === "PENDING")
    .reduce((sum, row) => sum + row._count._all, 0);
  const totalInProgress = grouped
    .filter((row) => row.status === "IN_PROGRESS")
    .reduce((sum, row) => sum + row._count._all, 0);
  const totalRemediation = grouped
    .filter((row) => ["REWASH", "REWORK", "FAILED"].includes(row.status))
    .reduce((sum, row) => sum + row._count._all, 0);

  return (
    <div className="space-y-5">
      <LiveRefresh intervalMs={15000} />
      <PageHeader
        title="Processing"
        description="Every workstation on the floor. Scan a garment, press one button, move on."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Waiting" value={totalPending} icon={Package} tone="warning" />
        <StatCard label="In progress" value={totalInProgress} tone="info" />
        <StatCard label="Rewash / rework" value={totalRemediation} tone="danger" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {WORKSTATION_STAGES.map((stage) => {
          const stageCounts = counts.get(stage) ?? {};
          const pending = stageCounts.PENDING ?? 0;
          const inProgress = stageCounts.IN_PROGRESS ?? 0;
          const done = (stageCounts.COMPLETED ?? 0) + (stageCounts.PASSED ?? 0);
          const failed =
            (stageCounts.FAILED ?? 0) +
            (stageCounts.REWASH ?? 0) +
            (stageCounts.REWORK ?? 0);

          const permission = STAGE_PERMISSION[stage] as PermissionCode;
          const canOperate = hasPermission(user, permission);

          return (
            <Link key={stage} href={`/processing/${stageSlug(stage)}`} className="block">
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="font-semibold">{STAGE_LABELS[stage]}</h2>
                      <p className="text-xs text-muted-foreground">
                        {canOperate ? "You can operate this station" : "View only"}
                      </p>
                    </div>
                    <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
                  </div>

                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-semibold numeric">{pending}</span>
                    <span className="text-sm text-muted-foreground">waiting</span>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {inProgress > 0 ? (
                      <Badge tone="progress">{inProgress} in progress</Badge>
                    ) : null}
                    {failed > 0 ? <Badge tone="danger">{failed} to redo</Badge> : null}
                    <Badge tone="neutral">{done} done</Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
