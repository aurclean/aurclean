import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Waypoints } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Barcode, QrCode } from "@/components/shared/code-image";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Timeline, type TimelineEntry } from "@/components/shared/timeline";
import {
  categoryLabel,
  categoryMeta,
  categorySlug,
} from "@/lib/garment-categories";
import { GarmentTools } from "@/app/(app)/garments/[code]/garment-tools";
import { prisma } from "@/lib/prisma";
import { formatDateTime, formatTime } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { assertBranchAccess, assertFirmAccess, hasPermission, requirePermission } from "@/lib/session";
import { humanize } from "@/lib/utils";
import {
  GARMENT_STATUS_LABELS,
  STAGE_LABELS,
  TASK_STATUS_LABELS,
} from "@/lib/workflow";

export const metadata = { title: "Garment" };

export default async function GarmentDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const user = await requirePermission(PERMISSIONS.GARMENT_VIEW);

  const decoded = decodeURIComponent(code);
  const garment = await prisma.garment.findFirst({
    where: {
      OR: [
        { garmentCode: decoded.toUpperCase() },
        { garmentCode: decoded },
        { id: code },
      ],
    },
    include: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          customerName: true,
          customerPhone: true,
          expectedDeliveryAt: true,
          status: true,
        },
      },
      garmentType: { select: { name: true, category: true } },
      service: { select: { name: true } },
      branch: { select: { name: true, code: true } },
      lastScannedBy: { select: { name: true } },
      statusHistory: { orderBy: { createdAt: "asc" } },
      scans: {
        orderBy: { scannedAt: "asc" },
        include: {
          scannedBy: { select: { name: true } },
          contextOrder: { select: { orderNumber: true } },
        },
      },
      exceptions: {
        orderBy: { reportedAt: "desc" },
        include: { reportedBy: { select: { name: true } } },
      },
      tasks: {
        orderBy: { sequence: "asc" },
        include: { assignedTo: { select: { name: true } } },
      },
      photos: {
        orderBy: { createdAt: "desc" },
        include: { uploadedBy: { select: { name: true } } },
      },
      complaints: {
        select: { id: true, complaintNumber: true, type: true, status: true },
      },
    },
  });

  if (!garment) notFound();
  assertBranchAccess(user, garment.branchId);
  assertFirmAccess(user, garment.firmId);

  // The next station on this garment's own route, which is what "update
  // status" advances it to.
  const openTask = garment.tasks.find((task) =>
    ["PENDING", "IN_PROGRESS"].includes(task.status),
  );
  const nextStage = openTask
    ? { stage: openTask.stage, label: STAGE_LABELS[openTask.stage] }
    : null;

  const statusTimeline: TimelineEntry[] = garment.statusHistory.map((entry) => ({
    id: entry.id,
    time: formatTime(entry.createdAt),
    title: GARMENT_STATUS_LABELS[entry.toStatus],
    description: entry.note,
    meta: `${STAGE_LABELS[entry.stage]}${entry.userName ? ` · ${entry.userName}` : ""} · ${formatDateTime(entry.createdAt)}`,
    tone:
      ["QC_FAILED", "REWASH", "REWORK", "LOST", "DAMAGED"].includes(entry.toStatus)
        ? "danger"
        : ["READY", "PACKED", "DELIVERED", "QC_PASSED"].includes(entry.toStatus)
          ? "success"
          : "default",
  }));

  // The one-line answer to "where has this been?" — the stations it passed
  // through, in order, with the time it cleared each one.
  const journey = (() => {
    const seen = new Map<string, Date>();
    for (const entry of garment.statusHistory) {
      if (!seen.has(entry.stage)) seen.set(entry.stage, entry.createdAt);
    }
    return [...seen.entries()].map(([stage, at]) => ({
      stage,
      label: STAGE_LABELS[stage as keyof typeof STAGE_LABELS] ?? stage,
      at,
    }));
  })();

  const scanTimeline: TimelineEntry[] = garment.scans.map((scan) => ({
    id: scan.id,
    time: formatTime(scan.scannedAt),
    title: `${STAGE_LABELS[scan.stage]}${scan.outcome === "MATCH" ? "" : ` — ${scan.outcome.replace(/_/g, " ").toLowerCase()}`}`,
    description:
      scan.outcome === "WRONG_ORDER"
        ? `Scanned under ${scan.contextOrder?.orderNumber ?? "another order"}`
        : (scan.note ?? scan.location),
    meta: `${scan.scannedBy?.name ?? "System"} · ${formatDateTime(scan.scannedAt)}`,
    tone: scan.outcome === "MATCH" ? "success" : "danger",
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={garment.garmentCode}
        description={`${garment.garmentType.name} · ${garment.service.name}`}
        actions={
          <>
            <Button asChild variant="outline" size="icon" aria-label="Back">
              <Link href="/garments">
                <ArrowLeft />
              </Link>
            </Button>
            <GarmentTools
              garmentId={garment.id}
              garmentCode={garment.garmentCode}
              orderId={garment.order.id}
              currentStage={garment.currentStage}
              nextStage={nextStage}
              canEdit={hasPermission(user, PERMISSIONS.GARMENT_UPDATE)}
              canUpload={hasPermission(user, PERMISSIONS.GARMENT_PHOTO_UPLOAD)}
              canAdvance={hasPermission(user, PERMISSIONS.PROCESSING_VIEW)}
              canScan={hasPermission(user, PERMISSIONS.GARMENT_SCAN)}
              details={{
                color: garment.color,
                brand: garment.brand,
                size: garment.size,
                fabric: garment.fabric,
                stainNotes: garment.stainNotes,
                damageNotes: garment.damageNotes,
              }}
            />
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            status={garment.status}
            label={GARMENT_STATUS_LABELS[garment.status]}
            dot
          />
          <StatusBadge
            status={garment.currentStage}
            label={STAGE_LABELS[garment.currentStage]}
            tone="neutral"
          />
          <Link href={`/tracking/${categorySlug(garment.trackingCategory)}`}>
            <StatusBadge
              status={garment.trackingCategory}
              tone="info"
              label={`${categoryMeta(garment.trackingCategory).emoji} ${categoryLabel(garment.trackingCategory)}`}
            />
          </Link>
          {garment.rewashCount > 0 ? (
            <StatusBadge
              status="REWASH"
              tone="warning"
              label={`${garment.rewashCount} rewash${garment.rewashCount > 1 ? "es" : ""}`}
            />
          ) : null}
          {garment.reworkCount > 0 ? (
            <StatusBadge
              status="REWORK"
              tone="warning"
              label={`${garment.reworkCount} rework${garment.reworkCount > 1 ? "s" : ""}`}
            />
          ) : null}
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Waypoints className="size-4" /> Where is it right now?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-2xl font-semibold">
                {STAGE_LABELS[garment.currentStage]}
              </p>
              <p className="text-sm text-muted-foreground">
                {garment.lastScannedAt
                  ? `Last scanned ${formatDateTime(garment.lastScannedAt)}${garment.lastScannedBy ? ` by ${garment.lastScannedBy.name}` : ""}`
                  : "Not scanned since intake"}
              </p>

              {journey.length > 0 ? (
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 pt-1 text-sm">
                  {journey.map((step, index) => (
                    <span key={step.stage} className="flex items-center gap-1.5">
                      {index > 0 ? (
                        <span className="text-muted-foreground" aria-hidden>
                          →
                        </span>
                      ) : null}
                      <span className="rounded-md bg-muted px-2 py-0.5">
                        {step.label}{" "}
                        <span className="font-mono text-xs text-muted-foreground">
                          {formatTime(step.at)}
                        </span>
                      </span>
                    </span>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {garment.exceptions.some((entry) => entry.status === "OPEN") ? (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardHeader>
                <CardTitle className="text-sm">Open issues</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {garment.exceptions
                  .filter((entry) => entry.status === "OPEN")
                  .map((entry) => (
                    <p key={entry.id}>
                      <span className="font-medium">
                        {entry.type.replace(/_/g, " ").toLowerCase()}
                      </span>
                      {entry.detail ? ` — ${entry.detail}` : ""}
                      <span className="block text-xs text-muted-foreground">
                        {entry.reportedBy?.name ?? "System"} ·{" "}
                        {formatDateTime(entry.reportedAt)}
                      </span>
                    </p>
                  ))}
              </CardContent>
            </Card>
          ) : null}

          <Tabs defaultValue="history">
            <TabsList>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="scans">Scans ({garment.scans.length})</TabsTrigger>
              <TabsTrigger value="stages">Stages</TabsTrigger>
              <TabsTrigger value="photos">Photos ({garment.photos.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="history">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    Immutable garment ledger
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Timeline entries={statusTimeline} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="scans">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Every scan of this tag</CardTitle>
                </CardHeader>
                <CardContent>
                  {scanTimeline.length > 0 ? (
                    <Timeline entries={scanTimeline} />
                  ) : (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      This tag has never been scanned.
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="stages">
              <Card>
                <CardContent className="overflow-x-auto p-0">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2.5 text-left">Stage</th>
                        <th className="px-4 py-2.5 text-left">Status</th>
                        <th className="px-4 py-2.5 text-left">Operator</th>
                        <th className="px-4 py-2.5 text-left">Completed</th>
                        <th className="px-4 py-2.5 text-right">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {garment.tasks.map((task) => (
                        <tr key={task.id} className="border-b border-border last:border-0">
                          <td className="px-4 py-2.5 font-medium">
                            {STAGE_LABELS[task.stage]}
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusBadge
                              status={task.status}
                              label={TASK_STATUS_LABELS[task.status]}
                            />
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {task.assignedTo?.name ?? "—"}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {task.completedAt ? formatDateTime(task.completedAt) : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right numeric text-muted-foreground">
                            {task.durationSeconds
                              ? `${Math.round(task.durationSeconds / 60)} min`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="photos">
              <Card>
                <CardContent className="pt-5">
                  {garment.photos.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No photos captured for this garment.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {garment.photos.map((photo) => (
                        <figure key={photo.id} className="space-y-1">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photo.url}
                            alt={photo.caption ?? `${garment.garmentCode} photo`}
                            className="aspect-square w-full rounded-lg border border-border object-cover"
                          />
                          <figcaption className="text-xs text-muted-foreground">
                            {humanize(photo.kind)} ·{" "}
                            {formatDateTime(photo.createdAt)}
                            {photo.uploadedBy ? ` · ${photo.uploadedBy.name}` : ""}
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Tag</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-3">
              <QrCode value={garment.qrPayload} size={140} label={garment.garmentCode} />
              <Barcode value={garment.barcodeValue} height={44} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Order</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Link
                href={`/orders/${garment.order.id}`}
                className="font-mono text-base font-semibold text-primary hover:underline"
              >
                {garment.order.orderNumber}
              </Link>
              <p>{garment.order.customerName}</p>
              <p className="font-mono text-muted-foreground">
                {garment.order.customerPhone}
              </p>
              <Separator />
              <dl className="space-y-1.5">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Order status</dt>
                  <dd><StatusBadge status={garment.order.status} /></dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Due</dt>
                  <dd>{formatDateTime(garment.order.expectedDeliveryAt)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Branch</dt>
                  <dd>{garment.branch.name}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-1.5 text-sm">
                {[
                  ["Type", garment.garmentType.name],
                  ["Category", garment.garmentType.category],
                  ["Service", garment.service.name],
                  ["Colour", garment.color],
                  ["Brand", garment.brand],
                  ["Size", garment.size],
                  ["Fabric", garment.fabric],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right">{value || "—"}</dd>
                  </div>
                ))}
              </dl>
              {garment.stainNotes || garment.damageNotes ? (
                <>
                  <Separator className="my-3" />
                  {garment.stainNotes ? (
                    <p className="text-sm">
                      <span className="text-muted-foreground">Stains: </span>
                      {garment.stainNotes}
                    </p>
                  ) : null}
                  {garment.damageNotes ? (
                    <p className="text-sm">
                      <span className="text-muted-foreground">Damage: </span>
                      {garment.damageNotes}
                    </p>
                  ) : null}
                </>
              ) : null}
            </CardContent>
          </Card>

          {garment.complaints.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Complaints</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {garment.complaints.map((complaint) => (
                  <Link
                    key={complaint.id}
                    href={`/complaints/${complaint.id}`}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/40"
                  >
                    <span className="font-mono">{complaint.complaintNumber}</span>
                    <StatusBadge status={complaint.status} />
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
