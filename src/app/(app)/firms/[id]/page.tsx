import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS, ROLE_LABELS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import {
  EditFirmDialog,
  ResetAdminAccessCodeButton,
  ToggleFirmStatusButton,
} from "@/app/(app)/firms/firm-dialogs";
import { EnterFirmButton } from "@/app/(app)/firms/enter-firm-button";

export const metadata = { title: "Firm details" };

export default async function FirmDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission(PERMISSIONS.FIRM_VIEW);
  const { id } = await params;

  const firm = await prisma.firm.findUnique({
    where: { id },
    include: {
      branches: {
        orderBy: { name: "asc" },
        select: { id: true, name: true, code: true, type: true, isActive: true },
      },
      users: {
        where: { role: "SUPER_ADMIN" },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, email: true, employeeCode: true, status: true },
      },
      _count: { select: { branches: true, users: true, orders: true, customers: true } },
    },
  });
  if (!firm) notFound();

  return (
    <div className="space-y-5">
      <PageHeader
        title={firm.name}
        description={`Firm code ${firm.code}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/firms">
                <ArrowLeft className="size-4" /> All firms
              </Link>
            </Button>
            <EnterFirmButton firmId={firm.id} firmName={firm.name} disabled={firm.status !== "ACTIVE"} />
            <EditFirmDialog
              firm={{
                id: firm.id,
                name: firm.name,
                legalName: firm.legalName,
                addressLine: firm.addressLine,
                city: firm.city,
                state: firm.state,
                pincode: firm.pincode,
                phone: firm.phone,
                email: firm.email,
                gstin: firm.gstin,
                pan: firm.pan,
                website: firm.website,
              }}
            />
            <ToggleFirmStatusButton firmId={firm.id} status={firm.status} />
          </div>
        }
      >
        <StatusBadge status={firm.status} />
      </PageHeader>

      {firm.status !== "ACTIVE" ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          This firm is deactivated. Its users cannot log in, and every API action, order
          creation and scan is blocked — but no data has been deleted.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Branches", value: firm._count.branches },
          { label: "Users", value: firm._count.users },
          { label: "Orders", value: firm._count.orders },
          { label: "Customers", value: firm._count.customers },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-6">
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Business details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <Detail label="Legal name" value={firm.legalName} />
          <Detail label="GSTIN" value={firm.gstin} />
          <Detail label="Phone" value={firm.phone} />
          <Detail label="Email" value={firm.email} />
          <Detail label="Address" value={firm.addressLine} />
          <Detail label="City" value={[firm.city, firm.state, firm.pincode].filter(Boolean).join(", ") || null} />
          <Detail label="Website" value={firm.website} />
          <Detail label="PAN" value={firm.pan} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Firm Admins</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {firm.users.length === 0 ? (
            <p className="text-sm text-muted-foreground">No admin account on this firm yet.</p>
          ) : (
            firm.users.map((admin) => (
              <div
                key={admin.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div>
                  <p className="font-medium">{admin.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {ROLE_LABELS.SUPER_ADMIN} · {admin.email} · {admin.employeeCode}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={admin.status} />
                  <ResetAdminAccessCodeButton userId={admin.id} />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Branches</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {firm.branches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No branches yet.</p>
          ) : (
            firm.branches.map((branch) => (
              <div key={branch.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                <div>
                  <p className="font-medium">{branch.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{branch.code}</p>
                </div>
                <StatusBadge status={branch.isActive ? "ACTIVE" : "INACTIVE"} />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value || "—"}</p>
    </div>
  );
}
