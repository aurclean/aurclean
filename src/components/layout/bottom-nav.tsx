"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Menu, ScanLine, ShoppingBag, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface BottomNavProps {
  onOpenSidebar: () => void;
  canScan?: boolean;
}

export function BottomNav({ onOpenSidebar, canScan = true }: BottomNavProps) {
  const pathname = usePathname();

  const isNavActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-border bg-card/95 px-1 backdrop-blur lg:hidden safe-area-pb shadow-[0_-4px_16px_-8px_rgb(16_24_40_/_0.15)]"
      aria-label="Mobile navigation"
    >
      <Link
        href="/dashboard"
        className={cn(
          "flex flex-1 flex-col items-center justify-center py-1 text-[11px] font-medium transition-colors",
          isNavActive("/dashboard")
            ? "text-primary font-semibold"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <LayoutDashboard className="size-5" />
        <span className="mt-0.5 truncate">Home</span>
      </Link>

      <Link
        href="/orders"
        className={cn(
          "flex flex-1 flex-col items-center justify-center py-1 text-[11px] font-medium transition-colors",
          isNavActive("/orders")
            ? "text-primary font-semibold"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <ShoppingBag className="size-5" />
        <span className="mt-0.5 truncate">Orders</span>
      </Link>

      {canScan ? (
        <Link
          href="/scan"
          className="flex flex-1 flex-col items-center justify-center py-1 text-[11px] font-semibold text-primary"
        >
          <div className={cn(
            "flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-transform active:scale-95",
            isNavActive("/scan") ? "ring-2 ring-primary/30 ring-offset-2 ring-offset-background" : ""
          )}>
            <ScanLine className="size-5" />
          </div>
          <span className="mt-0.5 truncate font-bold">Scan</span>
        </Link>
      ) : null}

      <Link
        href="/customers"
        className={cn(
          "flex flex-1 flex-col items-center justify-center py-1 text-[11px] font-medium transition-colors",
          isNavActive("/customers")
            ? "text-primary font-semibold"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Users className="size-5" />
        <span className="mt-0.5 truncate">Customers</span>
      </Link>

      <button
        type="button"
        onClick={onOpenSidebar}
        className="flex flex-1 flex-col items-center justify-center py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Open full menu"
      >
        <Menu className="size-5" />
        <span className="mt-0.5 truncate">More</span>
      </button>
    </nav>
  );
}
