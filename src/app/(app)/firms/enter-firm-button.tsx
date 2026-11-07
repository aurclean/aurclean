"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * A platform admin "entering" a firm to operate inside it. Calls the
 * NextAuth session update() trigger with the requested activeFirmId, which
 * src/auth.ts's jwt() callback re-validates server-side against the real
 * Firm table (must exist and be ACTIVE) before trusting it — this button
 * only requests the switch, it never sets the active firm itself.
 */
export function EnterFirmButton({
  firmId,
  firmName,
  disabled,
}: {
  firmId: string;
  firmName: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const { update } = useSession();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={disabled}
      loading={isPending}
      title={disabled ? `${firmName} is inactive` : `Enter ${firmName}`}
      onClick={() =>
        startTransition(async () => {
          await update({ activeFirmId: firmId });
          router.push("/dashboard");
          router.refresh();
        })
      }
    >
      <LogIn className="size-4" /> Enter
    </Button>
  );
}

/** Clears the active firm, returning a platform admin to the cross-firm view. */
export function LeaveFirmButton() {
  const router = useRouter();
  const { update } = useSession();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      loading={isPending}
      onClick={() =>
        startTransition(async () => {
          await update({ activeFirmId: null });
          router.push("/firms");
          router.refresh();
        })
      }
    >
      Exit firm
    </Button>
  );
}
