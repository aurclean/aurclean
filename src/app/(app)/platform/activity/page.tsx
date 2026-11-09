import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Platform activity" };
export const dynamic = "force-dynamic";

export default async function PlatformActivityPage() {
  await requirePermission(PERMISSIONS.PLATFORM_VIEW);

  const [audit, logins] = await Promise.all([
    prisma.auditLog.findMany({
      where: { action: { startsWith: "FIRM_" } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, action: true, summary: true, createdAt: true, firm: { select: { name: true } }, user: { select: { name: true } } },
    }),
    prisma.loginEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, event: true, ip: true, detail: true, createdAt: true, user: { select: { name: true, role: true } } },
    }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader title="Platform activity" description="Firm lifecycle changes and sign-in activity across the platform." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Firm changes</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {audit.map((a) => (
              <div key={a.id} className="flex justify-between gap-3 border-b pb-2 last:border-0">
                <span>{a.summary ?? a.action}{a.firm ? <span className="text-muted-foreground"> · {a.firm.name}</span> : null}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</span>
              </div>
            ))}
            {audit.length === 0 ? <p className="text-muted-foreground">Nothing yet.</p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Sign-ins</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {logins.map((l) => (
              <div key={l.id} className="flex justify-between gap-3 border-b pb-2 last:border-0">
                <span>
                  {l.event.replace(/_/g, " ").toLowerCase()}
                  {l.user ? <span className="text-muted-foreground"> · {l.user.name}</span> : null}
                  {l.detail ? <span className="text-muted-foreground"> ({l.detail})</span> : null}
                </span>
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
