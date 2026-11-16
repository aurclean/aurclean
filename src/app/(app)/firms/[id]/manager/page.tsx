import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { describeCodeStatus, getCodeStatuses } from "@/lib/services/platform-firms";
import { ResetAdminAccessCodeButton, RevokeAdminAccessButton } from "@/app/(app)/firms/firm-dialogs";
import { AddFirmManagerDialog, ManagerStatusButton } from "@/app/(app)/firms/[id]/manager/manager-controls";

export const metadata = { title: "Firm Manager" };
export const dynamic = "force-dynamic";

export default async function FirmManagerPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission(PERMISSIONS.FIRM_VIEW);
  const { id } = await params;

  const firm = await prisma.firm.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!firm) notFound();

  // Credential columns are never selected for display; only their status is derived.
  const managers = await prisma.user.findMany({
    where: { firmId: firm.id, role: "FIRM_MANAGER" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, phone: true, status: true, employeeCode: true, lastLoginAt: true, accessCodeHash: true, accessCodeIssuedAt: true },
  });
  const statuses = await getCodeStatuses(managers);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Firm: ${firm.name}`}
        description="Access codes are stored as hashes and cannot be viewed. Reissue a code to see a new one — once — and the old one stops working at once."
        actions={<AddFirmManagerDialog firmId={firm.id} />}
      />
      <Card className="border-emerald-900/15">
        <CardContent className="divide-y p-0">
          <div className="hidden grid-cols-[8rem_1fr_1.4fr_auto] gap-3 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid">
            <span>Role</span><span>User</span><span>Access code</span><span />
          </div>
          {managers.map((m) => (
            <div key={m.id} className="grid gap-3 px-4 py-4 text-sm md:grid-cols-[8rem_1fr_1.4fr_auto] md:items-center">
              <span className="font-medium text-emerald-900">Firm Manager</span>
              <div className="min-w-0">
                <p className="font-medium">{m.name} <StatusBadge status={m.status} /></p>
                <p className="truncate text-xs text-muted-foreground">{m.email}{m.phone ? ` · ${m.phone}` : ""}</p>
                <p className="text-xs text-muted-foreground">Last sign-in {m.lastLoginAt ? m.lastLoginAt.toLocaleString("en-GB") : "never"}</p>
              </div>
              <p className="text-xs text-muted-foreground">{describeCodeStatus(statuses.get(m.id)!)}</p>
              <div className="flex flex-wrap gap-2">
                <ResetAdminAccessCodeButton userId={m.id} />
                <RevokeAdminAccessButton userId={m.id} />
                <ManagerStatusButton userId={m.id} status={m.status} />
              </div>
            </div>
          ))}
          {managers.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No Firm Manager yet — add one.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
