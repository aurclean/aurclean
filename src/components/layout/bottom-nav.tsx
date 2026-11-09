"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import { mobileTabs } from "@/components/layout/nav-config";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/generated/prisma/enums";

interface BottomNavProps {
  role: UserRole;
  platformOnly?: boolean;
  onOpenSidebar: () => void;
}

/** Phone tab bar: at most four role-specific tabs plus "More" (full menu). */
export function BottomNav({ role, platformOnly = false, onOpenSidebar }: BottomNavProps) {
  const pathname = usePathname();
  const tabs = mobileTabs(role, platformOnly);
  const showMore = role === "FIRM_MANAGER" || role === "PLATFORM_SUPER_ADMIN";

  const active = (href: string, exact?: boolean) => {
    const path = href.split("?")[0];
    return exact ? pathname === path : pathname === path || pathname.startsWith(`${path}/`);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-border bg-card/95 px-1 backdrop-blur lg:hidden safe-area-pb shadow-[0_-4px_16px_-8px_rgb(16_24_40_/_0.15)]"
      aria-label="Mobile navigation"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "flex min-w-0 flex-1 flex-col items-center justify-center py-1 text-[11px] font-medium transition-colors",
            active(tab.href, tab.exact) ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <tab.icon className="size-5" />
          <span className="mt-0.5 w-full truncate text-center">{tab.label}</span>
        </Link>
      ))}
      {showMore ? (
        <button
          type="button"
          onClick={onOpenSidebar}
          className="flex flex-1 flex-col items-center justify-center py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Open full menu"
        >
          <Menu className="size-5" />
          <span className="mt-0.5 truncate">More</span>
        </button>
      ) : null}
    </nav>
  );
}
