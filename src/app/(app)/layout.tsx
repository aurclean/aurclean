import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { getAlerts } from "@/lib/services/alerts";
import { requireUser } from "@/lib/session";
import { LeaveFirmButton } from "@/app/(app)/firms/enter-firm-button";

/** Pages a PLATFORM_SUPER_ADMIN may open before explicitly entering a firm. */
const PLATFORM_ONLY_PATHS = ["/platform", "/firms", "/profile"];

/**
 * Defence in depth on top of per-page permission checks: staff roles are
 * confined to their own small set of screens.
 */
const ROLE_PATHS: Partial<Record<string, string[]>> = {
  FIELD_MANAGER: ["/field", "/profile"],
  QC: ["/qc", "/profile", "/scan", "/garments", "/processing", "/tracking"],
};

const EMPTY_ALERTS = { alerts: [], total: 0 };

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  // A PLATFORM_ADMIN who hasn't "entered" a firm yet has no activeFirmId —
  // that's their normal state while browsing the Firms module itself, not
  // an error. getAlerts() requires a resolved firm, so it's only called
  // once one is active; otherwise every page under this layout (including
  // /firms) would throw before it could even render.
  const platformOnly = !user.activeFirmId;
  if (platformOnly) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    if (!PLATFORM_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      redirect("/platform");
    }
  }
  const allowed = ROLE_PATHS[user.role];
  if (allowed) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    if (pathname && !allowed.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      redirect(user.role === "QC" ? "/qc" : "/field");
    }
  }
  const alerts = user.activeFirmId ? await getAlerts(user) : EMPTY_ALERTS;

  return (
    <AppShell
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
        branchName: user.branchName,
        permissions: user.permissions,
      }}
      platformOnly={platformOnly}
      alerts={{ alerts: alerts.alerts, total: alerts.total }}
    >
      {user.role === "PLATFORM_SUPER_ADMIN" && user.activeFirmId ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm">
          <span>
            Platform access: you are operating inside <strong>{user.activeFirmName}</strong>. Everything you change here belongs to this firm only.
          </span>
          <LeaveFirmButton />
        </div>
      ) : null}
      {children}
    </AppShell>
  );
}
