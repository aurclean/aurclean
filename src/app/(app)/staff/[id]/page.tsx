import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { RegenerateAccessCodeDialog } from "@/app/(app)/staff/staff-dialogs";
import {
  PermissionMatrix,
  type PermissionRow,
} from "@/app/(app)/staff/[id]/permission-matrix";
import { prisma } from "@/lib/prisma";
import { formatCurrency, num } from "@/lib/money";
import { formatDate, formatDateTime, formatTime } from "@/lib/dates";
import {
  PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  ROLE_LABELS,
  defaultPermissionsFor,
} from "@/lib/rbac";
import { assertBranchAccess, assertFirmAccess, hasPermission, requirePermission } from "@/lib/session";
import { humanize, initials } from "@/lib/utils";

export const metadata = { title: "Staff member" };

export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requirePermission(PERMISSIONS.STAFF_VIEW);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const staff = await prisma.user.findFirst({
    where: { OR: [{ id }, { phone: id }, { email: id }] },
    include: {
      branch: { select: { name: true, code: true } },
      staffProfile: { include: { shift: { select: { name: true, startTime: true, endTime: true } } } },
      driver: true,
      permissions: { include: { permission: { select: { code: true } } } },
      attendances: { orderBy: { date: "desc" }, take: 30 },
      leaves: { orderBy: { fromDate: "desc" }, take: 20 },
    },
  });

  if (!staff) notFound();
  assertBranchAccess(viewer, staff.branchId);
  assertFirmAccess(viewer, staff.firmId);

  const [allPermissions, completedTasks, recentTasks] = await Promise.all([
    prisma.permission.findMany({ orderBy: [{ module: "asc" }, { code: "asc" }] }),
    prisma.processingTask.count({
      where: {
        assignedToId: staff.id,
        status: { in: ["COMPLETED", "PASSED"] },
        completedAt: { gte: thirtyDaysAgo },
      },
    }),
    prisma.processingTask.findMany({
      where: { assignedToId: staff.id, completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
      take: 15,
      include: {
        garment: {
          select: {
            garmentCode: true,
            order: { select: { orderNumber: true } },
          },
        },
      },
    }),
  ]);

  const roleDefaults = new Set(defaultPermissionsFor(staff.role));
  const overrides = new Map(
    staff.permissions.map((entry) => [entry.permission.code, entry.granted]),
  );

  const permissionRows: PermissionRow[] = allPermissions.map((permission) => {
    const roleDefault = roleDefaults.has(permission.code as never);
    const override = overrides.has(permission.code)
      ? (overrides.get(permission.code) as boolean)
      : null;
    return {
      code: permission.code,
      module: permission.module,
      description:
        PERMISSION_DESCRIPTIONS[permission.code] ?? permission.description,
      roleDefault,
      override,
      effective: override ?? roleDefault,
    };
  });

  const canManage = hasPermission(viewer, PERMISSIONS.STAFF_MANAGE);
  const presentDays = staff.attendances.filter((entry) =>
    ["PRESENT", "HALF_DAY"].includes(entry.status),
  ).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title={staff.name}
        description={`${ROLE_LABELS[staff.role]}${staff.branch ? ` · ${staff.branch.name}` : ""}`}
        actions={
          <>
            <Button asChild variant="outline" size="icon" aria-label="Back to staff">
              <Link href="/staff">
                <ArrowLeft />
              </Link>
            </Button>
            {canManage ? (
              <RegenerateAccessCodeDialog userId={staff.id} name={staff.name} />
            ) : null}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={staff.status} dot />
          {staff.employeeCode ? (
            <span className="font-mono text-sm text-muted-foreground">
              {staff.employeeCode}
            </span>
          ) : null}
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Tasks completed (30d)" value={completedTasks} />
        <StatCard label="Days present (30d)" value={presentDays} tone="success" />
        <StatCard
          label="Last sign-in"
          value={staff.lastLoginAt ? formatDate(staff.lastLoginAt) : "Never"}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <Avatar className="size-12">
              <AvatarFallback className="text-base">{initials(staff.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <CardTitle className="truncate">{staff.name}</CardTitle>
              <p className="truncate text-sm text-muted-foreground">{staff.email}</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <dl className="space-y-1.5">
              {[
                ["Phone", staff.phone],
                ["Role", ROLE_LABELS[staff.role]],
                ["Branch", staff.branch?.name],
                ["Department", staff.staffProfile?.department],
                ["Designation", staff.staffProfile?.designation],
                [
                  "Joined",
                  staff.staffProfile?.dateOfJoining
                    ? formatDate(staff.staffProfile.dateOfJoining)
                    : null,
                ],
                [
                  "Shift",
                  staff.staffProfile?.shift
                    ? `${staff.staffProfile.shift.name} (${staff.staffProfile.shift.startTime}–${staff.staffProfile.shift.endTime})`
                    : null,
                ],
                ["Emergency contact", staff.staffProfile?.emergencyContact],
              ].map(([label, value]) => (
                <div key={label as string} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right">{value || "—"}</dd>
                </div>
              ))}
              {canManage && staff.staffProfile?.monthlySalary ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Salary</dt>
                  <dd className="numeric">
                    {formatCurrency(num(staff.staffProfile.monthlySalary))}
                  </dd>
                </div>
              ) : null}
            </dl>

            {staff.driver ? (
              <>
                <Separator />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Driver details
                  </p>
                  <p className="mt-1">
                    {staff.driver.vehicleNumber ?? "No vehicle"}{" "}
                    {staff.driver.vehicleType ? `· ${staff.driver.vehicleType}` : ""}
                  </p>
                  {staff.driver.licenseNumber ? (
                    <p className="font-mono text-xs text-muted-foreground">
                      Licence {staff.driver.licenseNumber}
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <Tabs defaultValue="permissions">
            <TabsList>
              <TabsTrigger value="permissions">Permissions</TabsTrigger>
              <TabsTrigger value="attendance">Attendance</TabsTrigger>
              <TabsTrigger value="leave">Leave</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            <TabsContent value="permissions">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    Effective access — role defaults with per-user overrides
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <PermissionMatrix
                    userId={staff.id}
                    permissions={permissionRows}
                    editable={canManage && staff.id !== viewer.id}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="attendance">
              <Card>
                <CardContent className="overflow-x-auto p-0">
                  {staff.attendances.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No attendance recorded yet.
                    </p>
                  ) : (
                    <table className="w-full min-w-[420px] text-sm">
                      <thead>
                        <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="px-4 py-2.5 text-left">Date</th>
                          <th className="px-4 py-2.5 text-left">Status</th>
                          <th className="px-4 py-2.5 text-left">In</th>
                          <th className="px-4 py-2.5 text-left">Out</th>
                        </tr>
                      </thead>
                      <tbody>
                        {staff.attendances.map((entry) => (
                          <tr key={entry.id} className="border-b border-border last:border-0">
                            <td className="px-4 py-2.5">{formatDate(entry.date)}</td>
                            <td className="px-4 py-2.5">
                              <StatusBadge status={entry.status} />
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground">
                              {entry.checkIn ? formatTime(entry.checkIn) : "—"}
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground">
                              {entry.checkOut ? formatTime(entry.checkOut) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="leave">
              <Card>
                <CardContent className="pt-5">
                  {staff.leaves.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No leave requests on record.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {staff.leaves.map((leave) => (
                        <li
                          key={leave.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                        >
                          <span>{humanize(leave.type)}</span>
                          <span className="text-muted-foreground">
                            {formatDate(leave.fromDate)} – {formatDate(leave.toDate)}
                          </span>
                          <StatusBadge status={leave.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="activity">
              <Card>
                <CardContent className="pt-5">
                  {recentTasks.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No completed processing work yet.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {recentTasks.map((task) => (
                        <li
                          key={task.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                        >
                          <Link
                            href={`/garments/${task.garment.garmentCode}`}
                            className="font-mono text-primary hover:underline"
                          >
                            {task.garment.garmentCode}
                          </Link>
                          <span>{humanize(task.stage)}</span>
                          <StatusBadge status={task.status} />
                          <span className="text-xs text-muted-foreground">
                            {task.completedAt ? formatDateTime(task.completedAt) : "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
