import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Firm activity" };
export const dynamic = "force-dynamic";

export default async function FirmActivityPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission(PERMISSIONS.FIRM_VIEW);
  const { id } = await params;
  const firm = await prisma.firm.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!firm) notFound();

  const [audit, logins] = await Promise.all([
    prisma.auditLog.findMany({
      where: { firmId: firm.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, action: true, summary: true, createdAt: true, user: { select: { name: true } } },
    }),
    prisma.loginEvent.findMany({
      where: { firmId: firm.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, event: true, createdAt: true, user: { select: { name: true } } },
    }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader title={`Activity — ${firm.name}`} description="Changes and sign-ins inside this firm only." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="border-emerald-900/15">
          <CardHeader><CardTitle className="text-base">Changes</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {audit.map((a) => (
              <div key={a.id} className="flex justify-between gap-3 border-b pb-2 last:border-0">
                <span>{a.summary ?? a.action}{a.user ? <span className="text-muted-foreground"> · {a.user.name}</span> : null}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</span>
              </div>
            ))}
            {audit.length === 0 ? <p className="text-muted-foreground">Nothing yet.</p> : null}
          </CardContent>
        </Card>
        <Card className="border-emerald-900/15">
          <CardHeader><CardTitle className="text-base">Sign-ins and access codes</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {logins.map((l) => (
              <div key={l.id} className="flex justify-between gap-3 border-b pb-2 last:border-0">
                <span>{l.event.replace(/_/g, " ").toLowerCase()}{l.user ? <span className="text-muted-foreground"> · {l.user.name}</span> : null}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(l.createdAt)}</span>
              </div>
            ))}
            {logins.length === 0 ? <p className="text-muted-foreground">Nothing yet.</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
