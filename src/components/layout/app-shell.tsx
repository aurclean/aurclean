"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { BottomNav } from "@/components/layout/bottom-nav";
import type { Alert } from "@/lib/services/alerts";
import type { PermissionCode } from "@/lib/rbac";
import type { UserRole } from "@/generated/prisma/enums";

interface AppShellProps {
  user: {
    name: string;
    email: string;
    role: UserRole;
    branchName: string | null;
    permissions: PermissionCode[];
  };
  /** True for a PLATFORM_ADMIN who hasn't entered a firm yet — restricts the sidebar to the Firms module. */
  platformOnly?: boolean;
  alerts: { alerts: Alert[]; total: number };
  children: ReactNode;
}

export function AppShell({ user, platformOnly, alerts, children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const canScan = !platformOnly && user.permissions.includes("garments.scan" as PermissionCode);

  return (
    <div className="min-h-dvh bg-background">
      <Sidebar
        permissions={user.permissions}
        platformOnly={platformOnly}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        user={user}
      />
      <div className="lg:pl-[272px]">
        <div className="mx-auto w-full max-w-[1600px] px-3 pt-3 sm:px-5 sm:pt-4">
          <Topbar
            name={user.name}
            email={user.email}
            role={user.role}
            branchName={user.branchName}
            alerts={alerts}
            canScan={canScan}
            onOpenSidebar={() => setSidebarOpen(true)}
          />
        </div>
        <main className="mx-auto w-full max-w-[1600px] px-3 pb-20 sm:px-5 sm:pb-6 lg:pb-6">
          <div key={pathname} className="route-enter">
            {children}
          </div>
        </main>
        <BottomNav
          onOpenSidebar={() => setSidebarOpen(true)}
          canScan={canScan}
        />
      </div>
    </div>
  );
}
