import Link from "next/link";
import { ShieldX } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata = { title: "Access denied" };

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10">
        <ShieldX className="size-7 text-destructive" aria-hidden />
      </div>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Access denied</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Your role does not include permission for this area. If you believe this
          is a mistake, ask your branch manager to review your access.
        </p>
      </div>
      <Button asChild>
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
