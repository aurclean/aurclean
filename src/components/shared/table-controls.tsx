"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Sorting and column choices live in the URL so they survive paging and reload. */
function useQueryWriter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      // Any change to the shape of the list starts it again from page one.
      if (!("page" in patch)) next.delete("page");
      router.push(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );
}

export function SortHeader({
  sortKey,
  label,
  align = "left",
}: {
  sortKey: string;
  label: ReactNode;
  align?: "left" | "right";
}) {
  const params = useSearchParams();
  const write = useQueryWriter();

  const active = params.get("sort") === sortKey;
  const dir = active ? (params.get("dir") ?? "asc") : null;

  return (
    <button
      type="button"
      onClick={() =>
        write({
          sort: sortKey,
          dir: active && dir === "asc" ? "desc" : "asc",
        })
      }
      className={cn(
        "group inline-flex items-center gap-1 text-inherit transition-colors hover:text-foreground",
        align === "right" && "flex-row-reverse",
      )}
    >
      {label}
      {dir === "asc" ? (
        <ArrowUp className="size-3" />
      ) : dir === "desc" ? (
        <ArrowDown className="size-3" />
      ) : (
        <ChevronsUpDown className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
      )}
    </button>
  );
}

export interface ToggleableColumn {
  key: string;
  label: string;
}

/**
 * Column visibility, also kept in the URL. Hidden keys are listed rather than
 * visible ones, so a column added later shows up by default instead of
 * disappearing for anyone with a saved link.
 */
export function ColumnToggle({ columns }: { columns: ToggleableColumn[] }) {
  const params = useSearchParams();
  const write = useQueryWriter();

  const hidden = new Set((params.get("hide") ?? "").split(",").filter(Boolean));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 /> Columns
          {hidden.size > 0 ? (
            <span className="ml-1 text-xs text-muted-foreground">({hidden.size} hidden)</span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Show columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((column) => {
          const visible = !hidden.has(column.key);
          return (
            <label
              key={column.key}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent"
            >
              <Checkbox
                checked={visible}
                onCheckedChange={() => {
                  const next = new Set(hidden);
                  if (visible) next.add(column.key);
                  else next.delete(column.key);
                  write({ hide: next.size ? [...next].join(",") : null });
                }}
              />
              {column.label}
            </label>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
