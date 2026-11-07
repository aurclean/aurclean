"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import {
  Archive,
  ArrowRight,
  Ban,
  ClipboardList,
  Copy,
  Eye,
  Loader2,
  MapPin,
  MoreVertical,
  Pencil,
  Plus,
  Printer,
  Receipt,
  RotateCcw,
  ScanLine,
  Trash2,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { signalDataChange } from "@/components/shared/live-refresh";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/action-result";

/**
 * Icons are named rather than passed as components: a server-rendered table
 * cannot hand a function to a Client Component, and an icon component is one.
 */
const ICONS = {
  archive: Archive,
  arrowRight: ArrowRight,
  ban: Ban,
  copy: Copy,
  list: ClipboardList,
  mapPin: MapPin,
  plus: Plus,
  printer: Printer,
  receipt: Receipt,
  rotate: RotateCcw,
  scan: ScanLine,
  truck: Truck,
  wallet: Wallet,
} as const;

export type ActionIcon = keyof typeof ICONS;

export interface ExtraAction {
  label: string;
  icon?: ActionIcon;
  href?: string;
  destructive?: boolean;
}

export interface DeleteConfig {
  /** What is being removed, in the reader's words — "Order ORD-5821". */
  subject: string;
  /** What removing it will and will not touch. */
  impact?: ReactNode;
  confirmLabel?: string;
  successMessage?: string;
  /**
   * A server action, already bound to its argument with `.bind(null, …)`.
   * A plain closure would be a function created on the server and cannot cross
   * into the browser; a bound server action can.
   */
  action: () => Promise<ActionResult<unknown>>;
}

interface RowActionsProps {
  viewHref?: string;
  editHref?: string;
  /** Rendered in place of the Edit button when the form is its own trigger. */
  editSlot?: ReactNode;
  remove?: DeleteConfig;
  extra?: ExtraAction[];
  /** Hides the icon buttons and folds everything into the ⋮ menu. */
  compact?: boolean;
}

/**
 * The actions column, identical on every table in the application: view, edit,
 * delete, and a ⋮ menu for whatever else that row can do.
 *
 * Deleting always goes through a confirmation that says what will be affected,
 * and a successful one broadcasts so every other open screen updates without a
 * refresh.
 */
export function RowActions({
  viewHref,
  editHref,
  editSlot,
  remove,
  extra = [],
  compact = false,
}: RowActionsProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const runDelete = () => {
    if (!remove) return;
    startTransition(async () => {
      const result = await remove.action();
      if (result.ok) {
        toast.success(remove.successMessage ?? `${remove.subject} removed`);
        setConfirming(false);
        signalDataChange();
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  const hasMenu = extra.length > 0;

  return (
    <div className="flex items-center justify-end gap-0.5">
      {!compact && viewHref ? (
        <IconLink href={viewHref} label="View" icon={Eye} />
      ) : null}

      {!compact && editSlot ? editSlot : null}

      {!compact && !editSlot && editHref ? (
        <IconLink href={editHref} label="Edit" icon={Pencil} />
      ) : null}

      {!compact && remove ? (
        <IconButton
          label="Delete"
          icon={Trash2}
          destructive
          onClick={() => setConfirming(true)}
        />
      ) : null}

      {hasMenu || compact ? (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="More actions">
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>More</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            {compact && viewHref ? (
              <DropdownMenuItem asChild>
                <Link href={viewHref}>
                  <Eye className="mr-2 size-4" /> View
                </Link>
              </DropdownMenuItem>
            ) : null}
            {compact && editHref ? (
              <DropdownMenuItem asChild>
                <Link href={editHref}>
                  <Pencil className="mr-2 size-4" /> Edit
                </Link>
              </DropdownMenuItem>
            ) : null}
            {extra.map((item) => {
              const Icon = item.icon ? ICONS[item.icon] : null;
              return (
                <DropdownMenuItem
                  key={item.label}
                  asChild
                  className={cn(item.destructive && "text-destructive")}
                >
                  <Link href={item.href ?? "#"}>
                    {Icon ? <Icon className="mr-2 size-4" /> : null}
                    {item.label}
                  </Link>
                </DropdownMenuItem>
              );
            })}
            {compact && remove ? (
              <>
                {extra.length > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem
                  className="text-destructive"
                  onSelect={(event) => {
                    event.preventDefault();
                    setConfirming(true);
                  }}
                >
                  <Trash2 className="mr-2 size-4" /> Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {remove ? (
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{remove.subject}”?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm text-muted-foreground">
                  {remove.impact ?? (
                    <p>This cannot be undone.</p>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending}
                onClick={(event) => {
                  event.preventDefault();
                  runDelete();
                }}
                className={buttonVariants({ variant: "destructive" })}
              >
                {pending ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" /> Deleting…
                  </>
                ) : (
                  (remove.confirmLabel ?? "Delete")
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}

function IconLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" size="icon-sm" aria-label={label}>
          <Link href={href}>
            <Icon />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function IconButton({
  label,
  icon: Icon,
  onClick,
  destructive,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
          className={cn(destructive && "text-destructive hover:bg-destructive/10")}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
