import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function BranchBadge({
  name,
  code,
  className,
}: {
  name: string | null | undefined;
  code?: string | null;
  className?: string;
}) {
  if (!name) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
      <Building2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{name}</span>
      {code ? (
        <span className="font-mono text-xs text-muted-foreground">({code})</span>
      ) : null}
    </span>
  );
}
