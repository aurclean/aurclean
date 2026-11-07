"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, Repeat, Search, UserRoundPlus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/money";
import { findCustomersAction } from "@/app/(app)/customers/actions";

export interface PickedCustomer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  pincode: string | null;
  landmark: string | null;
  orderCount: number;
  outstandingAmount: number;
}

/**
 * Directory lookup for the order form. Booking against an existing customer is
 * the common case at a counter, and retyping a regular's details is both slow
 * and how duplicate records get created.
 */
export function CustomerPicker({
  selected,
  onSelect,
  onClear,
}: {
  selected: PickedCustomer | null;
  onSelect: (customer: PickedCustomer) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedCustomer[]>([]);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      startTransition(async () => {
        const result = await findCustomersAction({ query });
        if (result.ok) {
          setResults(result.data);
          setOpen(true);
        }
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (selected) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {selected.name}
            {selected.orderCount > 1 ? (
              <Badge tone="success" className="gap-1">
                <Repeat className="size-3" /> {selected.orderCount} orders
              </Badge>
            ) : null}
            {selected.outstandingAmount > 0 ? (
              <Badge tone="danger">
                {formatCurrency(selected.outstandingAmount)} owing
              </Badge>
            ) : null}
          </p>
          <p className="font-mono text-xs text-muted-foreground">{selected.phone}</p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onClear}>
          <X /> Change
        </Button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search an existing customer by name or phone…"
          className="pl-9"
          aria-label="Search customers"
        />
        {pending ? (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {open && query.trim().length >= 2 ? (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          {results.length === 0 ? (
            <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
              <UserRoundPlus className="size-4" />
              No match — fill the details below and a new customer is created on booking.
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto">
              {results.map((customer) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition hover:bg-accent"
                    onClick={() => {
                      onSelect(customer);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{customer.name}</span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {customer.phone}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {customer.orderCount} order{customer.orderCount === 1 ? "" : "s"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
