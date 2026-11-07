"use client";

import { useTransition } from "react";
import { BellRing } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { sendPaymentRemindersAction } from "@/app/(app)/billing/actions";

export function ReminderButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      loading={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await sendPaymentRemindersAction();
          if (result.ok) {
            toast.success(
              result.data.sent === 0
                ? "No overdue balances to chase"
                : `${result.data.sent} payment reminders sent`,
            );
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      <BellRing /> Send reminders
    </Button>
  );
}
