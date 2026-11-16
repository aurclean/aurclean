import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Users & Staff" };
export const dynamic = "force-dynamic";

const GROUPS = [
  { role: "FIRM_MANAGER", title: "Firm Manager" },
  { role: "FIELD_MANAGER", title: "Field Managers" },
  { role: "QC", title: "QC" },
] as const;

/**
 * Read-only inspection of ONE firm's people. Every query is pinned to the
 * firm in the URL and selects no credential column — code state is derived
 * from "has a hash" only.
 */
export default async function FirmUsersPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission(PERMISSIONS.FIRM_VIEW);
  const { id } = await params;
  const firm = await prisma.firm.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!firm) notFound();

  const [staff, customerCount, customers] = await Promise.all([
    prisma.user.findMany({
      where: { firmId: firm.id, role: { in: ["FIRM_MANAGER", "FIELD_MANAGER", "QC"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, role: true, phone: true, status: true, createdAt: true, accessCodeHash: true, branch: { select: { name: true } } },
    }),
    prisma.customer.count({ where: { firmId: firm.id } }),
    prisma.customer.findMany({
      where: { firmId: firm.id },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, name: true, phone: true, createdAt: true, branch: { select: { name: true } } },
    }),
  ]);

  const Row = ({ name, phone, branch, code, status, created }: { name: string; phone: string | null; branch: string | null; code: string; status: string; created: Date }) => (
    <div className="grid gap-1 px-4 py-3 text-sm md:grid-cols-[1.4fr_1fr_1fr_1.2fr_auto_auto] md:items-center md:gap-3">
      <span className="font-medium">{name}</span>
      <span className="text-muted-foreground">{phone ?? "—"}</span>
      <span className="text-muted-foreground">{branch ?? "—"}</span>
      <span className="text-xs text-muted-foreground">{code}</span>
      <StatusBadge status={status} />
      <span className="text-xs text-muted-foreground">{formatDate(created)}</span>
    </div>
  );

  const header = (
    <div className="hidden grid-cols-[1.4fr_1fr_1fr_1.2fr_auto_auto] gap-3 border-b px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid">
      <span>Name</span><span>Phone</span><span>Branch</span><span>Access code</span><span>Status</span><span>Created</span>
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader title={`Users & Staff — ${firm.name}`} description="Read-only view of this firm's people. Daily staff management belongs to the Firm Manager." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[...GROUPS.map((g) => ({ label: g.title, value: staff.filter((u) => u.role === g.role).length })), { label: "Customers", value: customerCount }].map((c) => (
          <Card key={c.label} className="border-emerald-900/10">
            <CardContent className="pt-5">
              <p className="text-2xl font-bold text-emerald-900">{c.value}</p>
              <p className="text-xs text-muted-foreground">{c.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {GROUPS.map((g) => {
        const rows = staff.filter((u) => u.role === g.role);
        return (
          <Card key={g.role} className="border-emerald-900/15">
            <CardHeader><CardTitle className="text-base">{g.title} ({rows.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              {rows.length ? header : null}
              <div className="divide-y">
                {rows.map((u) => (
                  <Row key={u.id} name={u.name} phone={u.phone} branch={u.branch?.name ?? null} code={u.accessCodeHash ? "Active" : "Revoked"} status={u.status} created={u.createdAt} />
                ))}
                {rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">None yet.</p> : null}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Card className="border-emerald-900/15">
        <CardHeader><CardTitle className="text-base">Customers ({customerCount})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {customers.length ? header : null}
          <div className="divide-y">
            {customers.map((c) => (
              <Row key={c.id} name={c.name} phone={c.phone} branch={c.branch.name} code="OTP / personal link" status="ACTIVE" created={c.createdAt} />
            ))}
            {customers.length === 0 ? <p className="p-4 text-sm text-muted-foreground">None yet.</p> : null}
          </div>
          {customerCount > customers.length ? <p className="border-t p-3 text-xs text-muted-foreground">Showing the {customers.length} most recent of {customerCount}.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
