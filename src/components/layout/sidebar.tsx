"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";

import { cn, initials } from "@/lib/utils";
import { visibleSections, type NavItem } from "@/components/layout/nav-config";
import { ROLE_LABELS, type PermissionCode } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AurcleanLogo } from "@/components/shared/aurclean-logo";
import type { UserRole } from "@/generated/prisma/enums";

interface SidebarProps {
  permissions: PermissionCode[];
  platformOnly?: boolean;
  open: boolean;
  onClose: () => void;
  user: { name: string; email: string; role: UserRole; branchName: string | null };
}

function isActive(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function Sidebar({ permissions, platformOnly, open, onClose, user }: SidebarProps) {
  const pathname = usePathname();
  const sections = visibleSections(permissions, platformOnly);

  return (
    <>
      {open ? (
        <div
          className="animate-fade-in-soft fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar text-sidebar-foreground shadow-xl transition-transform duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] lg:translate-x-0 lg:shadow-sm",
          "lg:inset-y-4 lg:left-4 lg:h-[calc(100dvh-2rem)] lg:w-60 lg:rounded-2xl lg:border lg:border-sidebar-border",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-4">
          <Link href="/dashboard" className="flex items-center gap-2.5 rounded-xl px-1 py-1 transition-opacity hover:opacity-90">
            <AurcleanLogo size="sm" variant="full" theme="light" />
          </Link>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground lg:hidden"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X className="size-4" />
          </Button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto scrollbar-thin px-3 py-2">
          {sections.map((section, index) => (
            <div key={section.label ?? `section-${index}`} className="space-y-1">
              {section.label ? (
                <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-sidebar-muted">
                  {section.label}
                </p>
              ) : null}
              <NavGroup items={section.items} pathname={pathname} onNavigate={onClose} />
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-sidebar-border p-3">
          <Link
            href="/profile"
            className="flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-sidebar-hover"
          >
            <span className="relative shrink-0">
              <Avatar className="size-9">
                <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                  {initials(user.name)}
                </AvatarFallback>
              </Avatar>
              <span
                className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-sidebar bg-success"
                aria-hidden
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-sidebar-foreground">{user.name}</p>
              <p className="truncate text-xs text-sidebar-muted">
                {ROLE_LABELS[user.role]}
                {user.branchName ? ` · ${user.branchName}` : ""}
              </p>
            </div>
          </Link>
        </div>
      </aside>
    </>
  );
}

function NavGroup({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-all duration-200",
                active
                  ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-sm"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-hover hover:text-sidebar-foreground",
              )}
            >
              <item.icon
                className={cn(
                  "size-4 shrink-0 transition-transform duration-200 group-hover:scale-110",
                  active
                    ? "text-sidebar-accent-foreground"
                    : "text-sidebar-muted group-hover:text-sidebar-foreground",
                )}
                aria-hidden
              />
              <span className="truncate">{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
