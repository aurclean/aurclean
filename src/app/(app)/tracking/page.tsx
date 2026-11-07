import Link from "next/link";
import { AlertTriangle, PackageCheck, Shapes } from "lucide-react";

import { LiveRefresh } from "@/components/shared/live-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { getCategoryCounts } from "@/lib/services/garment-tracking";
import { categorySlug } from "@/lib/garment-categories";
import { cn } from "@/lib/utils";

export const metadata = { title: "Garment categories" };

export default async function TrackingPage() {
  const user = await requirePermission(PERMISSIONS.TRACKING_VIEW);
  const branchIds = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES)
    ? null
    : user.branchId
      ? [user.branchId]
      : [];
  const firmId = requireFirmId(user);

  const categories = await getCategoryCounts(firmId, branchIds);
  const onFloor = categories.reduce((sum, row) => sum + row.onFloor, 0);
  const issues = categories.reduce((sum, row) => sum + row.issues, 0);

  return (
    <div className="space-y-5">
      <LiveRefresh intervalMs={20000} />
      <PageHeader
        title="Garment categories"
        description={`${onFloor} pieces in the laundry right now. Open a category to see every piece in it and where it is.`}
      />

      {issues > 0 ? (
        <Link
          href="/mismatch"
          className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm transition hover:bg-warning/15"
        >
          <AlertTriangle className="size-4 text-warning-foreground" />
          <span className="font-medium">
            {issues} garment{issues === 1 ? "" : "s"} need attention
          </span>
          <span className="text-muted-foreground">— open the mismatch centre</span>
        </Link>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {categories.map((row) => (
          <Link
            key={row.category}
            href={`/tracking/${categorySlug(row.category)}`}
            className={cn(
              "group rounded-xl border border-border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
              row.onFloor === 0 && "opacity-60",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-2xl leading-none" aria-hidden>
                {row.emoji}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {row.prefix}-
              </span>
            </div>
            <p className="mt-3 text-sm font-medium">{row.label}</p>
            <p className="text-3xl font-semibold tracking-tight numeric">{row.onFloor}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {row.ready > 0 ? (
                <Badge tone="success" className="gap-1">
                  <PackageCheck className="size-3" /> {row.ready} ready
                </Badge>
              ) : null}
              {row.issues > 0 ? (
                <Badge tone="danger" className="gap-1">
                  <AlertTriangle className="size-3" /> {row.issues}
                </Badge>
              ) : null}
              {row.ready === 0 && row.issues === 0 ? (
                <span className="text-xs text-muted-foreground">
                  {row.onFloor === 0 ? "Nothing on the floor" : "All in progress"}
                </span>
              ) : null}
            </div>
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="flex items-start gap-3 pt-6 text-sm text-muted-foreground">
          <Shapes className="mt-0.5 size-4 shrink-0" />
          <p>
            Every piece carries its own id — <span className="font-mono">TR-1042</span> is
            the forty-second pair of trousers this branch has taken in — and belongs to
            exactly one order. A category is simply every piece of that kind currently in
            the building.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
