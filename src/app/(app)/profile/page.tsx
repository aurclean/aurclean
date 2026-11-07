import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { AccessCodeCard } from "@/app/(app)/profile/access-code-card";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/dates";
import { ROLE_LABELS, PERMISSION_DESCRIPTIONS } from "@/lib/rbac";
import { requireUser } from "@/lib/session";
import { initials } from "@/lib/utils";

export const metadata = { title: "My profile" };

export default async function ProfilePage() {
  const user = await requireUser();

  const record = await prisma.user.findUnique({
    where: { id: user.id },
    include: {
      branch: { select: { name: true, code: true } },
      staffProfile: { select: { department: true, designation: true, dateOfJoining: true } },
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader title="My profile" description="Your account and access." />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <Avatar className="size-12">
              <AvatarFallback className="text-base">{initials(user.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <CardTitle className="truncate">{user.name}</CardTitle>
              <CardDescription className="truncate">{user.email}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="space-y-1.5 text-sm">
              {[
                ["Employee code", user.employeeCode],
                ["Role", ROLE_LABELS[user.role]],
                ["Branch", record?.branch?.name],
                ["Department", record?.staffProfile?.department],
                ["Designation", record?.staffProfile?.designation],
                ["Phone", record?.phone],
                [
                  "Last sign-in",
                  record?.lastLoginAt ? formatDateTime(record.lastLoginAt) : "—",
                ],
              ].map(([label, value]) => (
                <div key={label as string} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right">{value || "—"}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Your access code</CardTitle>
            <CardDescription>
              Enter this on the sign-in screen. Keep it to yourself — anyone with it can
              sign in as you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AccessCodeCard accessCode={record?.accessCode ?? ""} />
            <p className="mt-3 text-xs text-muted-foreground">
              Need a new code? Ask a Super Admin to regenerate it from Staff.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What you can do</CardTitle>
          <CardDescription>
            {user.permissions.length} permissions granted by your role and any
            individual overrides.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
          {user.permissions.map((code) => (
            <Badge key={code} tone="neutral" title={code}>
              {PERMISSION_DESCRIPTIONS[code] ?? code}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
