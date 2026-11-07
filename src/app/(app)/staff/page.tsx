import Link from "next/link";
import { CalendarCheck, UserCheck, Users } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type Column } from "@/components/shared/data-table";
import { RowActions } from "@/components/shared/row-actions";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  AttendanceControl,
  LeaveDecisionControls,
  NewStaffDialog,
} from "@/app/(app)/staff/staff-dialogs";
import { setStaffStatusAction } from "@/app/(app)/staff/actions";
import { prisma } from "@/lib/prisma";
import { formatDate, toInputDate, todayRange } from "@/lib/dates";
import { PERMISSIONS, ROLE_LABELS, isGlobalRole } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { humanize } from "@/lib/utils";
import {
  branchOptions,
  enumOptions,
  param,
  scopedBranchId,
  type SearchParams,
} from "@/lib/queries/filters";
import type { Prisma } from "@/generated/prisma/client";
import type { UserRole } from "@/generated/prisma/enums";

export const metadata = { title: "Staff" };

const ALL_ROLES = Object.keys(ROLE_LABELS) as UserRole[];

interface StaffRow {
  id: string;
  employeeCode: string | null;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  status: string;
  branchName: string | null;
  department: string | null;
  attendanceToday: string | null;
  completedToday: number;
}

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requirePermission(PERMISSIONS.STAFF_VIEW);

  const branchId = scopedBranchId(user, params);
  const firmId = requireFirmId(user);
  const tab = param(params, "tab") ?? "people";
  const search = param(params, "q");
  const role = param(params, "role");
  const status = param(params, "status");
  const today = todayRange();
  const todayKey = toInputDate(today.from);

  const where: Prisma.UserWhereInput = {
    firmId,
    ...(branchId ? { branchId } : {}),
    ...(role && role !== "all" ? { role: role as UserRole } : {}),
    ...(status && status !== "all" ? { status: status as never } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { employeeCode: { contains: search.toUpperCase() } },
            { phone: { contains: search } },
          ],
        }
      : {}),
  };

  const [staff, branches, shifts, pendingLeaves, activeCount, presentToday, productivity] =
    await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: [{ status: "asc" }, { name: "asc" }],
        take: 200,
        include: {
          branch: { select: { name: true } },
          staffProfile: { select: { department: true, designation: true } },
          attendances: {
            where: { date: { gte: today.from, lte: today.to } },
            select: { status: true },
            take: 1,
          },
        },
      }),
      branchOptions(user),
      prisma.shift.findMany({
        where: { isActive: true, ...(branchId ? { branchId } : {}) },
        select: { id: true, name: true },
      }),
      prisma.leave.findMany({
        where: {
          status: "PENDING",
          user: { ...(branchId ? { branchId } : {}) },
        },
        orderBy: { fromDate: "asc" },
        include: { user: { select: { id: true, name: true, employeeCode: true } } },
      }),
      prisma.user.count({ where: { firmId, status: "ACTIVE", ...(branchId ? { branchId } : {}) } }),
      prisma.attendance.count({
        where: {
          status: { in: ["PRESENT", "HALF_DAY"] },
          date: { gte: today.from, lte: today.to },
          ...(branchId ? { branchId } : {}),
        },
      }),
      prisma.processingTask.groupBy({
        by: ["assignedToId"],
        where: {
          status: { in: ["COMPLETED", "PASSED"] },
          completedAt: { gte: today.from, lte: today.to },
          ...(branchId ? { branchId } : {}),
        },
        _count: { _all: true },
      }),
    ]);

  const productivityByUser = new Map(
    productivity
      .filter((row) => row.assignedToId)
      .map((row) => [row.assignedToId as string, row._count._all]),
  );

  const rows: StaffRow[] = staff.map((member) => ({
    id: member.id,
    employeeCode: member.employeeCode,
    name: member.name,
    email: member.email,
    phone: member.phone,
    role: member.role,
    status: member.status,
    branchName: member.branch?.name ?? null,
    department: member.staffProfile?.department ?? null,
    attendanceToday: member.attendances[0]?.status ?? null,
    completedToday: productivityByUser.get(member.id) ?? 0,
  }));

  const canManage = hasPermission(user, PERMISSIONS.STAFF_MANAGE);
  const canMarkAttendance = hasPermission(user, PERMISSIONS.STAFF_ATTENDANCE);
  const canApproveLeave = hasPermission(user, PERMISSIONS.STAFF_APPROVE_LEAVE);

  const assignableRoles = ALL_ROLES.filter((candidate) =>
    user.role === "SUPER_ADMIN" ? true : candidate !== "SUPER_ADMIN",
  );

  const columns: Column<StaffRow>[] = [
    {
      key: "person",
      header: "Employee",
      cell: (row) => (
        <div className="min-w-0 space-y-0.5">
          <Link
            href={`/staff/${row.id}`}
            className="block truncate text-sm font-medium text-primary hover:underline"
          >
            {row.name}
          </Link>
          <p className="font-mono text-xs text-muted-foreground">
            {row.employeeCode ?? "—"} · {row.email}
          </p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (row) => (
        <div className="space-y-0.5">
          <p className="text-sm">{ROLE_LABELS[row.role]}</p>
          {row.department ? (
            <p className="text-xs text-muted-foreground">{row.department}</p>
          ) : null}
        </div>
      ),
    },
    ...(isGlobalRole(user.role)
      ? [
          {
            key: "branch",
            header: "Branch",
            hideOnMobile: true,
            cell: (row: StaffRow) => (
              <span className="text-sm text-muted-foreground">{row.branchName ?? "—"}</span>
            ),
          } satisfies Column<StaffRow>,
        ]
      : []),
    { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} dot /> },
    {
      key: "productivity",
      header: "Done today",
      hideOnMobile: true,
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <span className="text-sm numeric">
          {row.completedToday > 0 ? row.completedToday : "—"}
        </span>
      ),
    },
    {
      key: "attendance",
      header: "Today",
      cell: (row) =>
        canMarkAttendance ? (
          <AttendanceControl
            userId={row.id}
            date={todayKey}
            current={row.attendanceToday}
          />
        ) : row.attendanceToday ? (
          <StatusBadge status={row.attendanceToday} />
        ) : (
          <span className="text-xs text-muted-foreground">Not marked</span>
        ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (row) => (
        <RowActions
          viewHref={`/staff/${row.id}`}
          extra={[
            { label: "Their orders", icon: "list", href: `/staff/${row.id}` },
          ]}
          remove={
            canManage && row.id !== user.id
              ? {
                  subject: row.name,
                  confirmLabel:
                    row.status === "ACTIVE" ? "Deactivate account" : "Reactivate account",
                  successMessage:
                    row.status === "ACTIVE"
                      ? `${row.name} deactivated`
                      : `${row.name} reactivated`,
                  impact:
                    row.status === "ACTIVE" ? (
                      <>
                        <p>
                          {row.name} is locked out and comes off the assignment lists. They
                          are never deleted — their name is on garment histories, payments
                          and the audit trail.
                        </p>
                        <p>Reactivate them here whenever they come back.</p>
                      </>
                    ) : (
                      <p>{row.name} can sign in again and be assigned work.</p>
                    ),
                  action: setStaffStatusAction.bind(null, {
                    staffId: row.id,
                    status: row.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                  }),
                }
              : undefined
          }
        />
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Staff"
        description="People, roles, attendance and daily output."
        actions={
          canManage ? (
            <NewStaffDialog
              branches={branches}
              shifts={shifts}
              assignableRoles={assignableRoles}
              defaultBranchId={user.branchId}
            />
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Active staff" value={activeCount} icon={Users} />
        <StatCard
          label="Present today"
          value={presentToday}
          icon={UserCheck}
          tone="success"
        />
        <StatCard
          label="Leave requests"
          value={pendingLeaves.length}
          icon={CalendarCheck}
          tone={pendingLeaves.length > 0 ? "warning" : "default"}
          href="/staff?tab=leave"
        />
      </div>

      <Tabs value={tab}>
        <TabsList>
          <TabsTrigger value="people" asChild>
            <Link href="/staff?tab=people">People</Link>
          </TabsTrigger>
          <TabsTrigger value="leave" asChild>
            <Link href="/staff?tab=leave">Leave ({pendingLeaves.length})</Link>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="people" className="space-y-4">
          <FilterBar
            searchPlaceholder="Name, email or employee code…"
            filters={[
              { name: "role", label: "Role", options: enumOptions(ALL_ROLES, ROLE_LABELS) },
              {
                name: "status",
                label: "Status",
                options: enumOptions(["ACTIVE", "SUSPENDED", "INACTIVE"] as const),
              },
              ...(branches.length > 1
                ? [{ name: "branch", label: "Branch", options: branches }]
                : []),
            ]}
          />
          <DataTable
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.id}
            empty={
              <EmptyState
                icon={Users}
                title="No staff found"
                description="Add your team so they can sign in and work the stations."
              />
            }
          />
        </TabsContent>

        <TabsContent value="leave">
          {pendingLeaves.length === 0 ? (
            <EmptyState
              icon={CalendarCheck}
              title="No pending leave"
              description="Leave requests waiting for a decision will appear here."
            />
          ) : (
            <ul className="space-y-2">
              {pendingLeaves.map((leave) => (
                <li
                  key={leave.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {leave.user.name}{" "}
                      <span className="font-mono text-xs text-muted-foreground">
                        {leave.user.employeeCode ?? ""}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {humanize(leave.type)} · {formatDate(leave.fromDate)} –{" "}
                      {formatDate(leave.toDate)}
                      {leave.reason ? ` · ${leave.reason}` : ""}
                    </p>
                  </div>
                  {canApproveLeave ? <LeaveDecisionControls leaveId={leave.id} /> : null}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
