import Link from "next/link";
import { ArrowLeft, Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { ResendButton, TemplateDialog } from "@/app/(app)/settings/settings-dialogs";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/dates";
import { NOTIFICATION_EVENT_LABELS } from "@/lib/services/notifications";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { scopedBranchId, type SearchParams } from "@/lib/queries/filters";
import type { NotificationEvent } from "@/generated/prisma/enums";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requirePermission(PERMISSIONS.NOTIFICATION_VIEW);
  const branchId = scopedBranchId(user, params);
  const firmId = requireFirmId(user);
  const canManage = hasPermission(user, PERMISSIONS.NOTIFICATION_MANAGE);

  const [templates, notifications, sent, failed] = await Promise.all([
    prisma.notificationTemplate.findMany({
      orderBy: [{ event: "asc" }, { channel: "asc" }],
    }),
    prisma.notification.findMany({
      where: { branch: { firmId }, ...(branchId ? { branchId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        order: { select: { id: true, orderNumber: true } },
        logs: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    prisma.notification.count({
      where: {
        branch: { firmId },
        status: { in: ["SENT", "DELIVERED", "READ"] },
        ...(branchId ? { branchId } : {}),
      },
    }),
    prisma.notification.count({
      where: { branch: { firmId }, status: "FAILED", ...(branchId ? { branchId } : {}) },
    }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description="Templates for counter notices and email, plus every message the system has raised."
        actions={
          <>
            <Button asChild variant="outline" size="icon" aria-label="Back to settings">
              <Link href="/settings">
                <ArrowLeft />
              </Link>
            </Button>
            {canManage ? <TemplateDialog /> : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Templates" value={templates.length} icon={Bell} />
        <StatCard label="Messages sent" value={sent} tone="success" />
        <StatCard label="Failed" value={failed} tone={failed > 0 ? "danger" : "default"} />
      </div>

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="log">Delivery log</TabsTrigger>
        </TabsList>

        <TabsContent value="templates">
          {templates.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="No templates"
              description="Without templates the system falls back to built-in default wording."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {templates.map((template) => (
                <Card key={template.id}>
                  <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{template.name}</CardTitle>
                      <p className="font-mono text-xs text-muted-foreground">
                        {template.code}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <StatusBadge status={template.channel} tone="info" />
                      <StatusBadge status={template.isActive ? "ACTIVE" : "INACTIVE"} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {NOTIFICATION_EVENT_LABELS[template.event as NotificationEvent]}
                    </p>
                    {template.subject ? (
                      <p className="text-sm font-medium">{template.subject}</p>
                    ) : null}
                    <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-2 font-mono text-xs">
                      {template.body}
                    </p>
                    {canManage ? (
                      <TemplateDialog
                        template={{
                          id: template.id,
                          code: template.code,
                          name: template.name,
                          channel: template.channel,
                          event: template.event,
                          subject: template.subject,
                          body: template.body,
                          isActive: template.isActive,
                        }}
                      />
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="log">
          {notifications.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="Nothing sent yet"
              description="Messages appear here as orders move through the workflow."
            />
          ) : (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2.5 text-left">When</th>
                      <th className="px-4 py-2.5 text-left">Order</th>
                      <th className="px-4 py-2.5 text-left">Event</th>
                      <th className="px-4 py-2.5 text-left">Channel</th>
                      <th className="px-4 py-2.5 text-left">To</th>
                      <th className="px-4 py-2.5 text-left">Status</th>
                      {canManage ? <th className="px-4 py-2.5" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {notifications.map((notification) => (
                      <tr
                        key={notification.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {formatDateTime(notification.createdAt)}
                        </td>
                        <td className="px-4 py-2.5">
                          {notification.order ? (
                            <Link
                              href={`/orders/${notification.order.id}`}
                              className="font-mono text-primary hover:underline"
                            >
                              {notification.order.orderNumber}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {NOTIFICATION_EVENT_LABELS[notification.event]}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={notification.channel} tone="info" />
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                          {notification.recipientPhone ?? notification.recipientEmail ?? "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={notification.status} dot />
                          {notification.errorMessage ? (
                            <p className="mt-0.5 max-w-48 truncate text-xs text-destructive">
                              {notification.errorMessage}
                            </p>
                          ) : null}
                        </td>
                        {canManage ? (
                          <td className="px-4 py-2.5 text-right">
                            {notification.status === "FAILED" ? (
                              <ResendButton notificationId={notification.id} />
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
