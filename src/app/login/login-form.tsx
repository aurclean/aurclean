"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { SubmitButton } from "@/components/shared/submit-button";
import { FormError } from "@/components/shared/form-field";
import { cn } from "@/lib/utils";
import { loginAction, type LoginState } from "@/app/login/actions";


export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "";
  const [state, formAction] = useActionState<LoginState, FormData>(loginAction, null);
  const [code, setCode] = useState("");
  const complete = code.replace(/[\s-]/g, "").length >= 4;

  useEffect(() => {
    if (state?.ok) {
      // A full refresh so the new session cookie is picked up by the server.
      router.replace(state.data.redirectTo);
      router.refresh();
    } else if (state && !state.ok) {
      setCode("");
    }
  }, [state, router]);

  return (
    <Card className="border border-emerald-500/20 bg-white/95 shadow-2xl backdrop-blur">
      <CardContent className="pt-6">
        <form action={formAction} className="space-y-6">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <input type="hidden" name="accessCode" value={code} />

          <div className="text-center space-y-1">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
              Enter Access Code
            </h2>
            <p className="text-xs text-slate-500">
              Enter the personal access code your manager gave you
            </p>
          </div>

          {state && !state.ok ? (
            <div className="animate-shake">
              <FormError message={state.error} />
            </div>
          ) : null}

          <input
            type="password"
            name="accessCodeVisible"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            autoComplete="one-time-code"
            inputMode="numeric"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            maxLength={24}
            aria-label="Access code"
            placeholder="000000"
            className={cn(
              "h-14 w-full rounded-xl border border-slate-200 bg-slate-50/50 text-center text-xl font-bold tracking-widest text-slate-900 shadow-sm transition-all",
              "focus:border-emerald-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30",
            )}
          />

          <SubmitButton className="h-12 w-full text-base bg-[#0a3b2c] hover:bg-[#06261c] text-white shadow-lg shadow-emerald-950/20" disabled={!complete}>
            Continue
          </SubmitButton>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500">
          Customer? <a href="/portal/login" className="font-semibold text-emerald-800 underline">Sign in to track your orders</a>
        </p>
      </CardContent>
    </Card>
  );
}
