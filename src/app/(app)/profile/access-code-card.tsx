"use client";

import { useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function AccessCodeCard({ accessCode }: { accessCode: string }) {
  const [visible, setVisible] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(accessCode);
      toast.success("Access code copied");
    } catch {
      toast.error("Could not copy — copy it manually");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex h-12 flex-1 items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 font-mono text-xl font-semibold tracking-[0.4em]">
        {visible ? accessCode : "•".repeat(accessCode.length)}
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide access code" : "Show access code"}
      >
        {visible ? <EyeOff /> : <Eye />}
      </Button>
      <Button type="button" variant="outline" size="icon" onClick={copy} aria-label="Copy access code">
        <Copy />
      </Button>
    </div>
  );
}
