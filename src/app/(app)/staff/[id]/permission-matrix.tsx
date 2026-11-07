"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  clearPermissionOverrideAction,
  setPermissionOverrideAction,
} from "@/app/(app)/staff/actions";
import { humanize } from "@/lib/utils";

export interface PermissionRow {
  code: string;
  module: string;
  description: string;
  roleDefault: boolean;
  override: boolean | null;
  effective: boolean;
}

export function PermissionMatrix({
  userId,
  permissions,
  editable,
}: {
  userId: string;
  permissions: PermissionRow[];
  editable: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const grouped = permissions.reduce<Record<string, PermissionRow[]>>((acc, row) => {
    (acc[row.module] ??= []).push(row);
    return acc;
  }, {});

  const toggle = (code: string, granted: boolean) =>
    startTransition(async () => {
      const result = await setPermissionOverrideAction({
        userId,
        permissionCode: code,
        granted,
      });
      if (result.ok) {
        toast.success(`${code} ${granted ? "granted" : "revoked"}`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  const reset = (code: string) =>
    startTransition(async () => {
      const result = await clearPermissionOverrideAction(userId, code);
      if (result.ok) {
        toast.success("Reset to role default");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });

  return (
    <div className="space-y-5">
      {Object.entries(grouped).map(([module, rows]) => (
        <section key={module}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {humanize(module)}
          </h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows.map((row) => (
              <li
                key={row.code}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {row.description}
                    {row.override !== null ? (
                      <Badge tone={row.override ? "success" : "danger"}>
                        {row.override ? "Granted" : "Revoked"}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">{row.code}</p>
                </div>

                <div className="flex items-center gap-2">
                  {row.override !== null && editable ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Reset ${row.code}`}
                      disabled={isPending}
                      onClick={() => reset(row.code)}
                    >
                      <RotateCcw />
                    </Button>
                  ) : null}
                  <Switch
                    checked={row.effective}
                    disabled={!editable || isPending}
                    onCheckedChange={(checked) => toggle(row.code, checked)}
                    aria-label={row.description}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
