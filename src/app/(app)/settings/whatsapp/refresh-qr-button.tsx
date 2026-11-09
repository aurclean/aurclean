"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { refreshQrAction } from "@/app/(app)/settings/whatsapp/actions";

/** Issues a new QR for this firm's own session only. */
export function RefreshQrButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await refreshQrAction();
          if (result.ok) {
            toast.success("New QR requested — it appears in a few seconds");
            setTimeout(() => router.refresh(), 2500);
          } else toast.error(result.error);
        })
      }
    >
      Refresh QR
    </Button>
  );
}
