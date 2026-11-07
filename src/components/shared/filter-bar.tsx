"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterDefinition {
  name: string;
  label: string;
  options: FilterOption[];
  /** Value that clears the filter. Defaults to "all". */
  allValue?: string;
  className?: string;
}

interface FilterBarProps {
  filters?: FilterDefinition[];
  searchPlaceholder?: string;
  showSearch?: boolean;
  showDateRange?: boolean;
  className?: string;
}

/**
 * URL-driven filters. Keeping state in the query string means every filtered
 * view is linkable, shareable and server-rendered.
 */
export function FilterBar({
  filters = [],
  searchPlaceholder = "Search…",
  showSearch = true,
  showDateRange = false,
  className,
}: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(searchParams.get("q") ?? "");

  useEffect(() => {
    setSearch(searchParams.get("q") ?? "");
  }, [searchParams]);

  const apply = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "" || value === "all") params.delete(key);
        else params.set(key, value);
      }
      // Any filter change invalidates the current page position.
      params.delete("page");
      const qs = params.toString();
      startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
    },
    [pathname, router, searchParams],
  );

  const activeCount = [...searchParams.keys()].filter(
    (key) => key !== "page" && searchParams.get(key),
  ).length;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {showSearch ? (
        <form
          className="relative min-w-0 flex-1 sm:max-w-xs"
          onSubmit={(event) => {
            event.preventDefault();
            apply({ q: search.trim() || null });
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={searchPlaceholder}
            className="pl-8"
            aria-label="Search"
          />
        </form>
      ) : null}

      {filters.map((filter) => {
        const allValue = filter.allValue ?? "all";
        const current = searchParams.get(filter.name) ?? allValue;
        return (
          <Select
            key={filter.name}
            value={current}
            onValueChange={(value) => apply({ [filter.name]: value })}
          >
            <SelectTrigger className={cn("h-9 w-auto min-w-36", filter.className)}>
              <SelectValue placeholder={filter.label} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={allValue}>{filter.label}: All</SelectItem>
              {filter.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      })}

      {showDateRange ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            type="date"
            className="h-9 w-auto min-w-0"
            aria-label="From date"
            value={searchParams.get("from") ?? ""}
            onChange={(event) => apply({ from: event.target.value || null })}
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="date"
            className="h-9 w-auto min-w-0"
            aria-label="To date"
            value={searchParams.get("to") ?? ""}
            onChange={(event) => apply({ to: event.target.value || null })}
          />
        </div>
      ) : null}

      {activeCount > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          loading={isPending}
          onClick={() => startTransition(() => router.push(pathname))}
        >
          <X /> Clear
        </Button>
      ) : null}
    </div>
  );
}
