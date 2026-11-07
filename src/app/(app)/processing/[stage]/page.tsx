import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Workstation, type QueueItem } from "@/app/(app)/processing/[stage]/workstation";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/dates";
import { PERMISSIONS, STAGE_PERMISSION, type PermissionCode } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import {
  STAGE_LABELS,
  STAGE_OUTCOMES,
  TASK_STATUS_LABELS,
  WORKSTATION_STAGES,
} from "@/lib/workflow";
import { param, scopedBranchId, type SearchParams } from "@/lib/queries/filters";
import type { ProcessingStage, TaskStatus } from "@/generated/prisma/enums";

const slugToStage = (slug: string): ProcessingStage | null => {
  const candidate = slug.toUpperCase().replace(/-/g, "_") as ProcessingStage;
  return WORKSTATION_STAGES.includes(candidate) ? candidate : null;
};

const OUTCOME_TONE: Record<string, "default" | "success" | "destructive" | "warning"> = {
  IN_PROGRESS: "default",
  COMPLETED: "success",
  PASSED: "success",
  FAILED: "destructive",
  REWASH: "warning",
  REWORK: "warning",
};

const OUTCOME_LABEL: Record<string, string> = {
  IN_PROGRESS: "Start work",
  COMPLETED: "Mark complete",
  PASSED: "Pass QC",
  FAILED: "Fail QC — send back",
  REWASH: "Send for rewash",
  REWORK: "Send for rework",
};

/** Queue tabs shown at each station. */
const QUEUE_TABS: TaskStatus[] = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "PASSED",
  "FAILED",
  "REWASH",
  "REWORK",
];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ stage: string }>;
}) {
  const { stage } = await params;
  const resolved = slugToStage(stage);
  return { title: resolved ? STAGE_LABELS[resolved] : "Workstation" };
}

export default async function WorkstationPage({
  params,
  searchParams,
}: {
  params: Promise<{ stage: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ stage: slug }, query] = await Promise.all([params, searchParams]);
  const stage = slugToStage(slug);
  if (!stage) notFound();

  const user = await requirePermission(PERMISSIONS.PROCESSING_VIEW);
  const branchId = scopedBranchId(user, query);
  const firmId = requireFirmId(user);
  const canOperate = hasPermission(user, STAGE_PERMISSION[stage] as PermissionCode);

  const requestedStatus = (param(query, "queue") ?? "PENDING").toUpperCase() as TaskStatus;
  const status = QUEUE_TABS.includes(requestedStatus) ? requestedStatus : "PENDING";

  const [tasks, counts] = await Promise.all([
    prisma.processingTask.findMany({
      where: {
        stage,
        status,
        branch: { firmId },
        ...(branchId ? { branchId } : {}),
        garment: { status: { notIn: ["LOST", "DELIVERED"] } },
      },
      orderBy: [{ garment: { order: { priority: "desc" } } }, { createdAt: "asc" }],
      take: 300,
      include: {
        garment: {
          include: {
            garmentType: { select: { name: true } },
            service: { select: { name: true } },
            // Needed to tell "ready for this station" apart from "still upstream".
            tasks: { select: { sequence: true, status: true } },
            order: {
              select: {
                id: true,
                orderNumber: true,
                customerName: true,
                expectedDeliveryAt: true,
                priority: true,
              },
            },
          },
        },
      },
    }),
    prisma.processingTask.groupBy({
      by: ["status"],
      where: { stage, branch: { firmId }, ...(branchId ? { branchId } : {}) },
      _count: { _all: true },
    }),
  ]);

  const now = new Date();
  const DONE: TaskStatus[] = ["COMPLETED", "PASSED", "SKIPPED"];

  // A garment only belongs at this station once every earlier stage is done.
  // Anything still upstream is counted, not listed, so the queue an operator
  // sees is exactly the work they can actually pick up.
  const isReady = (task: (typeof tasks)[number]) =>
    !task.garment.tasks.some(
      (other) => other.sequence < task.sequence && !DONE.includes(other.status),
    );

  const actionable = tasks.filter(isReady);
  const waitingUpstream = tasks.length - actionable.length;

  const items: QueueItem[] = actionable.slice(0, 200).map((task) => ({
    taskId: task.id,
    garmentId: task.garmentId,
    garmentCode: task.garment.garmentCode,
    orderNumber: task.garment.order.orderNumber,
    orderId: task.garment.order.id,
    customerName: task.garment.order.customerName,
    typeName: task.garment.garmentType.name,
    serviceName: task.garment.service.name,
    taskStatus: task.status,
    garmentStatus: task.garment.status,
    dueAt: formatDate(task.garment.order.expectedDeliveryAt),
    isDelayed: task.garment.order.expectedDeliveryAt < now,
    priority: task.garment.order.priority,
  }));

  const countByStatus = new Map(counts.map((row) => [row.status, row._count._all]));

  const outcomes = (STAGE_OUTCOMES[stage] ?? []).map((outcome) => ({
    value: outcome as string,
    label: OUTCOME_LABEL[outcome] ?? TASK_STATUS_LABELS[outcome],
    tone: OUTCOME_TONE[outcome] ?? "default",
  }));

  const visibleTabs = QUEUE_TABS.filter(
    (tab) =>
      tab === "PENDING" ||
      tab === "IN_PROGRESS" ||
      (countByStatus.get(tab) ?? 0) > 0 ||
      (STAGE_OUTCOMES[stage] ?? []).includes(tab),
  );

  return (
    <div className="space-y-5">
      <LiveRefresh intervalMs={15000} />
      <PageHeader
        title={`${STAGE_LABELS[stage]} station`}
        description="Scan garments in, choose an outcome, and the pipeline advances itself."
        actions={
          <Button asChild variant="outline">
            <Link href="/processing">
              <ArrowLeft /> All stations
            </Link>
          </Button>
        }
      >
        <Tabs value={status}>
          <TabsList className="flex-wrap">
            {visibleTabs.map((tab) => (
              <TabsTrigger key={tab} value={tab} asChild>
                <Link href={`/processing/${slug}?queue=${tab}`}>
                  {TASK_STATUS_LABELS[tab]}
                  <span className="ml-1 text-xs text-muted-foreground numeric">
                    {countByStatus.get(tab) ?? 0}
                  </span>
                </Link>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </PageHeader>

      <Workstation
        stage={stage}
        stageLabel={STAGE_LABELS[stage]}
        items={items}
        outcomes={outcomes}
        canOperate={canOperate}
        waitingUpstream={waitingUpstream}
      />
    </div>
  );
}
