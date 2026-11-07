import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock3, ScanLine, ShieldCheck } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { param, type SearchParams } from "@/lib/queries/filters";
import { GARMENT_CATEGORIES, categorySlug, parseCategory } from "@/lib/garment-categories";
import {
  MISMATCH_LABELS,
  detectMismatches,
  getMismatchOverview,
  type MismatchFinding,
  type MismatchKind,
} from "@/lib/services/garment-tracking";

import { MismatchActions } from "./mismatch-actions";

export const metadata = { title: "Mismatch Center" };

const KIND_TONE: Record<MismatchKind, "danger" | "warning"> = {
  MISSING: "danger",
  WRONG_ORDER: "danger",
  WRONG_GARMENT: "danger",
  DUPLICATE_SCAN: "danger",
  NOT_SCANNED: "warning",
};

export default async function MismatchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const user = await requirePermission(PERMISSIONS.TRACKING_VIEW);
  const branchIds = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW_ALL_BRANCHES)
    ? null
    : user.branchId
      ? [user.branchId]
      : [];
  const firmId = requireFirmId(user);

  const category = parseCategory(param(params, "category"));
  const kind = param(params, "kind");
  const search = param(params, "q")?.trim().toLowerCase();

  const [overview, allFindings] = await Promise.all([
    getMismatchOverview(firmId, branchIds),
    detectMismatches({ firmId, branchIds, category }),
  ]);

  const findings = allFindings.filter((finding) => {
    if (kind && kind !== "all" && finding.kind !== kind) return false;
    if (!search) return true;
    return (
      finding.garmentCode.toLowerCase().includes(search) ||
      finding.orderNumber.toLowerCase().includes(search) ||
      finding.customerName.toLowerCase().includes(search) ||
      finding.customerPhone.includes(search.replace(/\D/g, "") || search)
    );
  });

  const totals = overview.reduce(
    (acc, row) => ({
      total: acc.total + row.summary.total,
      correct: acc.correct + row.summary.correct,
    }),
    { total: 0, correct: 0 },
  );

  const canResolve = hasPermission(user, PERMISSIONS.TRACKING_RESOLVE);
  const canReassign = hasPermission(user, PERMISSIONS.ORDER_UPDATE);

  return (
    <div className="space-y-5">
      <LiveRefresh intervalMs={15000} />
      <PageHeader
        title="Mismatch Center"
        description={`${totals.correct} of ${totals.total} pieces on the floor account for themselves. The rest are here.`}
        actions={
          <Button asChild>
            <Link href="/scan">
              <ScanLine /> Scan tag
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {overview.map((row) => {
          const problems = row.summary.total - row.summary.correct;
          return (
            <Link
              key={row.category}
              href={`/mismatch?category=${categorySlug(row.category)}`}
              className={`rounded-xl border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                category === row.category ? "border-primary" : "border-border"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium">
                  <span aria-hidden>{row.emoji}</span> {row.label}
                </p>
                <p className="text-lg font-semibold numeric">{row.summary.total}</p>
              </div>
              <ul className="mt-2 space-y-0.5 text-xs">
                <Line tone="ok" count={row.summary.correct} label="Correct" />
                <Line tone="bad" count={row.summary.missing} label="Missing" />
                <Line tone="bad" count={row.summary.wrongOrder} label="Wrong order" />
                <Line tone="bad" count={row.summary.wrongGarment} label="Wrong garment" />
                <Line tone="bad" count={row.summary.duplicate} label="Duplicate scan" />
                <Line tone="warn" count={row.summary.notScanned} label="Not scanned" />
              </ul>
              {problems === 0 ? (
                <p className="mt-2 flex items-center gap-1 text-xs text-success">
                  <ShieldCheck className="size-3.5" /> All accounted for
                </p>
              ) : null}
            </Link>
          );
        })}
      </div>

      <FilterBar
        searchPlaceholder="Garment id, order number, customer or phone…"
        filters={[
          {
            name: "category",
            label: "Category",
            options: GARMENT_CATEGORIES.map((meta) => ({
              value: categorySlug(meta.value),
              label: meta.label,
            })),
          },
          {
            name: "kind",
            label: "Problem",
            options: (Object.keys(MISMATCH_LABELS) as MismatchKind[]).map((value) => ({
              value,
              label: MISMATCH_LABELS[value],
            })),
          },
        ]}
      />

      {findings.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing to reconcile"
          description={
            category || kind || search
              ? "No garment matches these filters. Clear them to see everything that needs attention."
              : "Every garment on the floor has been scanned where it should be, under the order it belongs to."
          }
        />
      ) : (
        <div className="space-y-3">
          {findings.map((finding) => (
            <FindingCard
              key={`${finding.garmentId}-${finding.kind}`}
              finding={finding}
              canResolve={canResolve}
              canReassign={canReassign}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Line({
  tone,
  count,
  label,
}: {
  tone: "ok" | "bad" | "warn";
  count: number;
  label: string;
}) {
  if (count === 0) return null;
  const dot = tone === "ok" ? "🟢" : tone === "bad" ? "🔴" : "🟠";
  return (
    <li className="flex items-center justify-between gap-2 text-muted-foreground">
      <span>
        <span aria-hidden>{dot}</span> {label}
      </span>
      <span className="numeric font-medium text-foreground">{count}</span>
    </li>
  );
}

function FindingCard({
  finding,
  canResolve,
  canReassign,
}: {
  finding: MismatchFinding;
  canResolve: boolean;
  canReassign: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/garments/${finding.garmentCode}`}
                className="font-mono text-lg font-semibold text-primary hover:underline"
              >
                {finding.garmentCode}
              </Link>
              <Badge tone={KIND_TONE[finding.kind]} className="gap-1">
                <AlertTriangle className="size-3" /> {MISMATCH_LABELS[finding.kind]}
              </Badge>
              <Badge tone="neutral">{finding.categoryLabel}</Badge>
              {finding.reported ? <Badge tone="outline">Reported</Badge> : null}
              <StatusBadge status={finding.status} label={finding.statusLabel} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{finding.detail}</p>
          </div>
          <p
            className={`text-sm ${
              finding.expectedDeliveryAt.getTime() < Date.now()
                ? "font-medium text-destructive"
                : "text-muted-foreground"
            }`}
          >
            Due {formatDate(finding.expectedDeliveryAt)}
          </p>
        </div>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Order">
            <Link
              href={`/orders/${finding.orderId}`}
              className="font-mono text-primary hover:underline"
            >
              {finding.orderNumber}
            </Link>
          </Fact>
          <Fact label="Customer">
            {finding.customerId ? (
              <Link href={`/customers/${finding.customerId}`} className="hover:underline">
                {finding.customerName}
              </Link>
            ) : (
              finding.customerName
            )}
            <span className="block font-mono text-xs text-muted-foreground">
              {finding.customerPhone}
            </span>
          </Fact>
          <Fact label="Expected location">{finding.expectedLocation}</Fact>
          <Fact label="Last scanned">
            {finding.lastScanAt ? (
              <>
                {finding.lastScanLocation}
                <span className="block text-xs text-muted-foreground">
                  <Clock3 className="mr-1 inline size-3" />
                  {formatDateTime(finding.lastScanAt)}
                  {finding.lastScanBy ? ` · ${finding.lastScanBy}` : ""}
                </span>
              </>
            ) : (
              <span className="text-destructive">Never scanned</span>
            )}
          </Fact>
        </dl>

        <MismatchActions
          garmentId={finding.garmentId}
          garmentCode={finding.garmentCode}
          orderId={finding.orderId}
          orderNumber={finding.orderNumber}
          canResolve={canResolve}
          canReassign={canReassign}
          isMissing={finding.kind === "MISSING"}
        />
      </CardContent>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{children}</dd>
    </div>
  );
}
