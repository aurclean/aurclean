import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PERMISSIONS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { MAX_FAILED_ATTEMPTS, LOCKOUT_WINDOW_MS } from "@/lib/login-security";

export const metadata = { title: "Platform settings" };

/** Platform-wide configuration. Read-only: these values are set by deployment configuration. */
export default async function PlatformSettingsPage() {
  await requirePermission(PERMISSIONS.PLATFORM_VIEW);
  const rows: Array<[string, string]> = [
    ["WhatsApp gateway", process.env.OPENWA_BASE_URL || process.env.OPENWA_API_URL || "http://localhost:8080 (default)"],
    ["Gateway API key", process.env.OPENWA_API_KEY ? "configured" : "NOT configured"],
    ["Access code format", "12 characters (XXXX-XXXX-XXXX), stored as an HMAC hash"],
    ["Sign-in lockout", `${MAX_FAILED_ATTEMPTS} failed attempts per ${LOCKOUT_WINDOW_MS / 60000} minutes per client`],
    ["Session lifetime", "12 hours"],
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="Platform settings" description="Platform-wide configuration (set through deployment environment)." />
      <Card>
        <CardHeader><CardTitle>Configuration</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b pb-2 last:border-0">
              <span className="text-muted-foreground">{k}</span>
              <span className="text-right">{v}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
