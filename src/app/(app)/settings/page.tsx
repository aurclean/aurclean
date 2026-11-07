import Link from "next/link";
import {
  Bell,
  Building2,
  ChevronRight,
  FileText,
  ScrollText,
  Shirt,
  Wallet,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { GeneralSettingsForm } from "@/app/(app)/settings/settings-dialogs";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS, type PermissionCode } from "@/lib/rbac";
import { hasPermission, requirePermission } from "@/lib/session";

export const metadata = { title: "Settings" };

const SECTIONS: {
  href: string;
  title: string;
  description: string;
  icon: typeof Building2;
  permission: PermissionCode;
}[] = [
  {
    href: "/settings/documents",
    title: "Document & PDF Branding",
    description: "Company details, GSTIN, prefixes, terms & PDF footers",
    icon: FileText,
    permission: PERMISSIONS.SETTINGS_MANAGE,
  },
  {
    href: "/settings/branches",
    title: "Branches",
    description: "Head office, branches and the central processing unit",
    icon: Building2,
    permission: PERMISSIONS.BRANCH_VIEW,
  },
  {
    href: "/settings/catalogue",
    title: "Services & garments",
    description: "What you offer, what you accept and what it costs",
    icon: Shirt,
    permission: PERMISSIONS.CATALOGUE_MANAGE,
  },
  {
    href: "/settings/notifications",
    title: "Notifications",
    description: "Counter and email notice templates plus the delivery log",
    icon: Bell,
    permission: PERMISSIONS.NOTIFICATION_VIEW,
  },
  {
    href: "/settings/expenses",
    title: "Expenses",
    description: "Operating costs that feed the profit figure",
    icon: Wallet,
    permission: PERMISSIONS.EXPENSE_VIEW,
  },
  {
    href: "/settings/audit",
    title: "Audit log",
    description: "Who changed what, and when",
    icon: ScrollText,
    permission: PERMISSIONS.AUDIT_VIEW,
  },
];

export default async function SettingsPage() {
  const user = await requirePermission([
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.BRANCH_VIEW,
    PERMISSIONS.CATALOGUE_MANAGE,
    PERMISSIONS.NOTIFICATION_VIEW,
  ]);

  const settings = await prisma.setting.findMany();
  const byKey = new Map(settings.map((setting) => [setting.key, setting.value]));

  const visible = SECTIONS.filter((section) =>
    hasPermission(user, section.permission),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description="Configure the business, its catalogue and how it talks to customers."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((section) => (
          <Link key={section.href} href={section.href}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardContent className="flex items-start gap-3 p-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <section.icon className="size-4.5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{section.title}</p>
                  <p className="text-xs text-muted-foreground">{section.description}</p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {hasPermission(user, PERMISSIONS.SETTINGS_MANAGE) ? (
        <Card>
          <CardHeader>
            <CardTitle>General</CardTitle>
          </CardHeader>
          <CardContent>
            <GeneralSettingsForm
              initial={{
                appName: byKey.get("app_name") ?? "Aura Laundry",
                gstRate: Number(byKey.get("gst_rate") ?? 18),
                defaultTurnaroundHours: Number(
                  byKey.get("default_turnaround_hours") ?? 48,
                ),
                lowStockAlerts: (byKey.get("low_stock_alerts") ?? "true") === "true",
                requireFullPaymentBeforeDelivery:
                  (byKey.get("require_full_payment_before_delivery") ?? "false") === "true",
              }}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
