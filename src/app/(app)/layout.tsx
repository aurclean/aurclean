import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { getAlerts } from "@/lib/services/alerts";
import { requireUser } from "@/lib/session";

const EMPTY_ALERTS = { alerts: [], total: 0 };

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  // A PLATFORM_ADMIN who hasn't "entered" a firm yet has no activeFirmId —
  // that's their normal state while browsing the Firms module itself, not
  // an error. getAlerts() requires a resolved firm, so it's only called
  // once one is active; otherwise every page under this layout (including
  // /firms) would throw before it could even render.
  const platformOnly = !user.activeFirmId;
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
      {children}
    </AppShell>
  );
}
