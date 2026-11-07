import { Badge } from "@/components/ui/badge";
import { cn, humanize } from "@/lib/utils";
import { toneFor, type BadgeTone } from "@/lib/workflow";

interface StatusBadgeProps {
  status: string | null | undefined;
  label?: string;
  tone?: BadgeTone;
  className?: string;
  dot?: boolean;
}

const DOT_COLORS: Record<BadgeTone, string> = {
  neutral: "bg-muted-foreground",
  info: "bg-info",
  progress: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

/** Consistent status pill used across every module. */
export function StatusBadge({ status, label, tone, className, dot }: StatusBadgeProps) {
  const resolvedTone = tone ?? toneFor(status);
  return (
    <Badge data-slot="status-badge" tone={resolvedTone} className={cn("gap-1.5", className)}>
      {dot ? (
        <span
          className={cn("size-1.5 rounded-full", DOT_COLORS[resolvedTone])}
          aria-hidden
        />
      ) : null}
      {label ?? humanize(status)}
    </Badge>
  );
}
