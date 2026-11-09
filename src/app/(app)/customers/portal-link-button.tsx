"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createPortalLinkAction } from "@/app/(app)/customers/actions";

export function PortalLinkButton({ customerId }: { customerId: string }) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);

  const issue = (send: boolean) =>
    startTransition(async () => {
      const result = await createPortalLinkAction({ customerId, send });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setUrl(result.data.url);
      if (send) {
        if (result.data.sent) toast.success("Sent on your firm's WhatsApp");
        else toast.error(result.data.sendError ?? "Could not send");
      }
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" loading={pending} onClick={() => issue(false)}>Customer portal link</Button>
      <Button variant="outline" size="sm" loading={pending} onClick={() => issue(true)}>Send link on WhatsApp</Button>
      {url ? (
        <button type="button" className="max-w-full truncate text-xs underline" onClick={() => navigator.clipboard.writeText(url).then(() => toast.success("Link copied"))}>
          {url} (copy — shown once)
        </button>
      ) : null}
    </div>
  );
}
