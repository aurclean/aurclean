"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";

/**
 * One box that answers "where is this?" — accepts garment codes, order
 * numbers, rack slots or a customer phone number and routes to the answer.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");

  return (
    <form
      className="relative w-full max-w-md"
      onSubmit={(event) => {
        event.preventDefault();
        const query = value.trim();
        if (!query) return;
        router.push(`/search?q=${encodeURIComponent(query)}`);
      }}
    >
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search…"
        className="h-10 rounded-full border-transparent bg-muted pl-10 shadow-none focus-visible:border-input focus-visible:bg-card"
        aria-label="Global search"
      />
    </form>
  );
}
