"use client";

import Link from "next/link";
import { Menu, ScanLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/components/layout/global-search";
import { NotificationBell } from "@/components/layout/notification-bell";
import { UserMenu } from "@/components/layout/user-menu";
import type { Alert } from "@/lib/services/alerts";
import type { UserRole } from "@/generated/prisma/enums";

import { AurcleanLogo } from "@/components/shared/aurclean-logo";

interface TopbarProps {
  name: string;
  email: string;
  role: UserRole;
  branchName: string | null;
  alerts: { alerts: Alert[]; total: number };
  canScan: boolean;
  onOpenSidebar: () => void;
}

export function Topbar({
  name,
  email,
  role,
  branchName,
  alerts,
  canScan,
  onOpenSidebar,
}: TopbarProps) {
  return (
    <header className="sticky top-3 z-30 mb-4 flex h-16 items-center gap-2 rounded-2xl border border-border bg-card px-3 shadow-sm sm:top-4 sm:px-4">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenSidebar}
        aria-label="Open navigation"
      >
        <Menu />
      </Button>

      <div className="lg:hidden flex items-center shrink-0 mr-1">
        <Link href="/dashboard" className="flex items-center">
          <AurcleanLogo size="sm" variant="full" theme="auto" />
        </Link>
      </div>

      <div className="min-w-0 flex-1">
        <GlobalSearch />
      </div>

      {canScan ? (
        <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
          <Link href="/scan">
            <ScanLine /> Scan
          </Link>
        </Button>
      ) : null}

      <NotificationBell feed={alerts} />

      <UserMenu name={name} email={email} role={role} branchName={branchName} />
    </header>
  );
}
