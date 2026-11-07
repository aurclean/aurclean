"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { signalDataChange } from "@/components/shared/live-refresh";
import type { ActionResult } from "@/lib/action-result";

interface SelectionState {
  selected: Set<string>;
  toggle: (id: string) => void;
  setAll: (ids: string[], on: boolean) => void;
  clear: () => void;
}

const SelectionContext = createContext<SelectionState | null>(null);

function useSelection(): SelectionState {
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error("Selection controls must be used inside <SelectionProvider>");
  }
  return context;
}

/**
 * Holds which rows are ticked.
 *
 * It wraps a server-rendered table — the rows come through as children, so the
 * table itself stays on the server and only the checkboxes and the action bar
 * ship to the browser.
 */
export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setAll = useCallback((ids: string[], on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const value = useMemo(
    () => ({ selected, toggle, setAll, clear }),
    [selected, toggle, setAll, clear],
  );

  return <SelectionContext value={value}>{children}</SelectionContext>;
}

export function RowCheckbox({ id, label }: { id: string; label: string }) {
  const { selected, toggle } = useSelection();
  return (
    <Checkbox
      checked={selected.has(id)}
      onCheckedChange={() => toggle(id)}
      aria-label={`Select ${label}`}
    />
  );
}

export function SelectAllCheckbox({ ids }: { ids: string[] }) {
  const { selected, setAll } = useSelection();
  const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
  return (
    <Checkbox
      checked={allOn}
      onCheckedChange={() => setAll(ids, !allOn)}
      aria-label={allOn ? "Clear selection" : "Select every row on this page"}
    />
  );
}

export interface BulkAction {
  label: string;
  /** Runs against the ticked ids and reports how many it managed. */
  run: (ids: string[]) => Promise<ActionResult<unknown>>;
  destructive?: boolean;
}

/**
 * A bar that slides up while rows are ticked. It stays out of the way until
 * there is something to act on, which is why it is fixed to the bottom rather
 * than taking a permanent row of the layout.
 */
export function BulkBar({
  noun = "row",
  actions,
}: {
  noun?: string;
  actions: BulkAction[];
}) {
  const { selected, clear } = useSelection();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (selected.size === 0) return null;
  const ids = [...selected];

  return (
    <div className="animate-fade-up pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-full border border-border bg-card px-3 py-2 shadow-lg">
        <span className="px-1 text-sm font-medium">
          {selected.size} {noun}
          {selected.size === 1 ? "" : "s"} selected
        </span>
        {actions.map((action) => (
          <Button
            key={action.label}
            size="sm"
            variant={action.destructive ? "destructive" : "outline"}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await action.run(ids);
                if (result.ok) {
                  toast.success(`${action.label} · ${ids.length} ${noun}s`);
                  clear();
                  signalDataChange();
                  router.refresh();
                } else {
                  toast.error(result.error);
                }
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : null}
            {action.label}
          </Button>
        ))}
        <Button size="icon-sm" variant="ghost" onClick={clear} aria-label="Clear selection">
          <X />
        </Button>
      </div>
    </div>
  );
}
