import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  ComplaintAttachmentUpload,
  ComplaintWorkflow,
} from "@/app/(app)/complaints/complaint-dialogs";
import { prisma } from "@/lib/prisma";
import { formatCurrency, num } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { assertBranchAccess, assertFirmAccess, hasPermission, requirePermission } from "@/lib/session";
import { humanize } from "@/lib/utils";

export const metadata = { title: "Complaint" };

export default async function ComplaintDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePermission(PERMISSIONS.COMPLAINT_VIEW);

  const complaint = await prisma.complaint.findFirst({
    where: { OR: [{ id }, { complaintNumber: id }] },
    include: {
      branch: { select: { name: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          customerName: true,
          customerPhone: true,
          paidAmount: true,
          refundedAmount: true,
          totalAmount: true,
        },
      },
      garment: {
        select: { id: true, garmentCode: true, status: true, garmentType: { select: { name: true } } },
      },
      assignedTo: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      resolvedBy: { select: { name: true } },
      attachments: {
        orderBy: { createdAt: "desc" },
        include: { uploadedBy: { select: { name: true } } },
      },
    },
  });

  if (!complaint) notFound();
  assertBranchAccess(user, complaint.branchId);
  assertFirmAccess(user, complaint.firmId);

  const assignees = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      role: { in: ["SUPER_ADMIN", "MANAGER"] },
      ...(complaint.branchId ? { branchId: complaint.branchId } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const maxRefund = complaint.order
    ? num(complaint.order.paidAmount) - num(complaint.order.refundedAmount)
    : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={complaint.complaintNumber}
        description={`${humanize(complaint.type)} · raised ${formatDateTime(complaint.createdAt)}${complaint.createdBy ? ` by ${complaint.createdBy.name}` : ""}`}
        actions={
          <Button asChild variant="outline">
            <Link href="/complaints">
              <ArrowLeft /> All complaints
            </Link>
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={complaint.status} dot />
          <StatusBadge status={complaint.priority} />
          <span className="text-sm text-muted-foreground">{complaint.branch.name}</span>
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>What happened</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="whitespace-pre-wrap text-sm">{complaint.description}</p>
              <Separator />
              <p className="text-sm text-muted-foreground">
                Raised by <span className="font-medium text-foreground">{complaint.raisedByName}</span>
                {complaint.raisedByPhone ? ` · ${complaint.raisedByPhone}` : ""}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Investigation & resolution</CardTitle>
            </CardHeader>
            <CardContent>
              <ComplaintWorkflow
                complaintId={complaint.id}
                status={complaint.status}
                priority={complaint.priority}
                assignedToId={complaint.assignedToId}
                investigationNotes={complaint.investigationNotes}
                assignees={assignees}
                maxRefund={maxRefund}
                canManage={hasPermission(user, PERMISSIONS.COMPLAINT_MANAGE)}
                canResolve={hasPermission(user, PERMISSIONS.COMPLAINT_RESOLVE)}
              />
            </CardContent>
          </Card>

          {complaint.resolution ? (
            <Card className="border-success/40 bg-success/5">
              <CardHeader>
                <CardTitle>Resolved as {humanize(complaint.resolution)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="whitespace-pre-wrap">{complaint.resolutionNotes}</p>
                {complaint.compensationAmount ? (
                  <p>
                    Amount:{" "}
                    <span className="font-semibold numeric">
                      {formatCurrency(complaint.compensationAmount)}
                    </span>
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {complaint.resolvedAt ? formatDateTime(complaint.resolvedAt) : ""}
                  {complaint.resolvedBy ? ` · ${complaint.resolvedBy.name}` : ""}
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Evidence ({complaint.attachments.length})</CardTitle>
              {hasPermission(user, [
                PERMISSIONS.COMPLAINT_CREATE,
                PERMISSIONS.COMPLAINT_MANAGE,
              ]) ? (
                <ComplaintAttachmentUpload complaintId={complaint.id} />
              ) : null}
            </CardHeader>
            <CardContent>
              {complaint.attachments.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No photos attached yet.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {complaint.attachments.map((attachment) => (
                    <figure key={attachment.id} className="space-y-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={attachment.url}
                        alt={attachment.caption ?? "Complaint evidence"}
                        className="aspect-square w-full rounded-lg border border-border object-cover"
                      />
                      <figcaption className="text-xs text-muted-foreground">
                        {formatDateTime(attachment.createdAt)}
                        {attachment.uploadedBy ? ` · ${attachment.uploadedBy.name}` : ""}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          {complaint.order ? (
            <Card>
              <CardHeader>
                <CardTitle>Order</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Link
                  href={`/orders/${complaint.order.id}`}
                  className="font-mono text-base font-semibold text-primary hover:underline"
                >
                  {complaint.order.orderNumber}
                </Link>
                <p>{complaint.order.customerName}</p>
                <p className="font-mono text-muted-foreground">
                  {complaint.order.customerPhone}
                </p>
                <Separator />
                <dl className="space-y-1.5">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Order value</dt>
                    <dd className="numeric">{formatCurrency(complaint.order.totalAmount)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Paid</dt>
                    <dd className="numeric">{formatCurrency(complaint.order.paidAmount)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Refundable</dt>
                    <dd className="numeric">{formatCurrency(maxRefund)}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          ) : null}

          {complaint.garment ? (
            <Card>
              <CardHeader>
                <CardTitle>Garment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Link
                  href={`/garments/${complaint.garment.garmentCode}`}
                  className="font-mono text-base font-semibold text-primary hover:underline"
                >
                  {complaint.garment.garmentCode}
                </Link>
                <p>{complaint.garment.garmentType.name}</p>
                <StatusBadge status={complaint.garment.status} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Ownership</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Assigned to</span>
                <span>{complaint.assignedTo?.name ?? "Unassigned"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Logged by</span>
                <span>{complaint.createdBy?.name ?? "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Branch</span>
                <span>{complaint.branch.name}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
