"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { label: "Firm Overview", path: "" },
  { label: "Firm Manager", path: "/manager" },
  { label: "Users & Staff", path: "/users" },
  { label: "WhatsApp Status", path: "/whatsapp" },
  { label: "Firm Activity", path: "/activity" },
];

export function FirmTabs({ firmId }: { firmId: string }) {
  const pathname = usePathname();
  const base = `/firms/${firmId}`;
  return (
    <nav aria-label="Firm sections" className="-mx-1 flex gap-1 overflow-x-auto border-b border-emerald-900/15 px-1 pb-px">
      {TABS.map((tab) => {
        const href = `${base}${tab.path}`;
        const active = tab.path === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={tab.label}
            href={href}
            className={cn(
              "whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active ? "border-emerald-800 text-emerald-900" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
