import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { BranchDialog } from "@/app/(app)/settings/settings-dialogs";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { humanize } from "@/lib/utils";

export const metadata = { title: "Branches" };

interface BranchRow {
  id: string;
  code: string;
  name: string;
  type: string;
  parentName: string | null;
  city: string | null;
  phone: string | null;
  isActive: boolean;
  staff: number;
  orders: number;
  raw: {
    id: string;
    code: string;
    name: string;
    type: string;
    parentId: string | null;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    phone: string | null;
    email: string | null;
    gstNumber: string | null;
    isActive: boolean;
  };
}

export default async function BranchesPage() {
  const user = await requirePermission(PERMISSIONS.BRANCH_VIEW);
  const canManage = hasPermission(user, PERMISSIONS.BRANCH_MANAGE);
  const firmId = requireFirmId(user);

  const branches = await prisma.branch.findMany({
    where: { firmId },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    include: {
      parent: { select: { name: true } },
      _count: { select: { users: true, orders: true } },
    },
  });

  const rows: BranchRow[] = branches.map((branch) => ({
    id: branch.id,
    code: branch.code,
    name: branch.name,
    type: branch.type,
    parentName: branch.parent?.name ?? null,
    city: branch.city,
    phone: branch.phone,
    isActive: branch.isActive,
    staff: branch._count.users,
    orders: branch._count.orders,
    raw: {
      id: branch.id,
      code: branch.code,
      name: branch.name,
      type: branch.type,
      parentId: branch.parentId,
      addressLine: branch.addressLine,
      city: branch.city,
      state: branch.state,
      pincode: branch.pincode,
      phone: branch.phone,
      email: branch.email,
      gstNumber: branch.gstNumber,
      isActive: branch.isActive,
    },
  }));

  const options = branches.map((branch) => ({ id: branch.id, name: branch.name }));

  const columns: Column<BranchRow>[] = [
    {
      key: "branch",
      header: "Branch",
      cell: (row) => (
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{row.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{row.code}</p>
        </div>
      ),
    },
    { key: "type", header: "Type", cell: (row) => <StatusBadge status={row.type} tone="neutral" label={humanize(row.type)} /> },
    {
      key: "parent",
      header: "Reports to",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{row.parentName ?? "—"}</span>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-sm text-muted-foreground">
          <p>{row.city ?? "—"}</p>
          {row.phone ? <p className="font-mono text-xs">{row.phone}</p> : null}
        </div>
      ),
    },
    {
      key: "staff",
      header: "Staff",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => <span className="text-sm numeric">{row.staff}</span>,
    },
    {
      key: "orders",
      header: "Orders",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => <span className="text-sm numeric">{row.orders}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.isActive ? "ACTIVE" : "INACTIVE"} />,
    },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "",
            className: "text-right",
            cell: (row: BranchRow) => (
              <BranchDialog branches={options} branch={row.raw} />
            ),
          } satisfies Column<BranchRow>,
        ]
      : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Branches"
        description="The organisation tree every record is filed against."
        actions={
          <>
            <Button asChild variant="outline" size="icon" aria-label="Back to settings">
              <Link href="/settings">
                <ArrowLeft />
              </Link>
            </Button>
            {canManage ? <BranchDialog branches={options} /> : null}
          </>
        }
      />

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={Building2}
            title="No branches"
            description="Create at least one branch before booking orders."
          />
        }
      />
    </div>
  );
}
