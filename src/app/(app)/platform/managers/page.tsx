import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Firm Managers" };
export const dynamic = "force-dynamic";

export default async function FirmManagersPage() {
  await requirePermission(PERMISSIONS.FIRM_VIEW);

  // Select list deliberately excludes every credential column.
  const managers = await prisma.user.findMany({
    where: { role: "FIRM_MANAGER" },
    orderBy: [{ firm: { name: "asc" } }, { createdAt: "asc" }],
    select: {
      id: true, name: true, email: true, phone: true, status: true, lastLoginAt: true, accessCodeIssuedAt: true,
      accessCodeHash: true, firm: { select: { id: true, name: true, code: true } },
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Firm Managers"
        description="One manager (at least) per firm. Open the firm to issue a new access code or revoke access."
      />
      <Card>
        <CardContent className="divide-y p-0">
          {managers.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-medium">{m.name}</p>
                <p className="text-xs text-muted-foreground">{m.email}{m.phone ? ` · ${m.phone}` : ""}</p>
                <p className="text-xs text-muted-foreground">
                  {m.firm?.name} <span className="font-mono">({m.firm?.code})</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>{m.accessCodeHash ? `Code issued ${m.accessCodeIssuedAt ? formatDateTime(m.accessCodeIssuedAt) : "earlier"}` : "No active code (revoked)"}</span>
                <span>Last sign-in {m.lastLoginAt ? formatDateTime(m.lastLoginAt) : "never"}</span>
                <StatusBadge status={m.status} />
                {m.firm ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/firms/${m.firm.id}`}>Manage</Link>
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          {managers.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No Firm Managers yet.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
