"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { SubmitButton } from "@/components/shared/submit-button";
import { FormError } from "@/components/shared/form-field";
import { cn } from "@/lib/utils";
import { loginAction, type LoginState } from "@/app/login/actions";

const CODE_LENGTH = 6;

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "";
  const [state, formAction] = useActionState<LoginState, FormData>(loginAction, null);
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const formRef = useRef<HTMLFormElement>(null);

  const code = digits.join("");
  const complete = code.length === CODE_LENGTH;

  useEffect(() => {
    if (state?.ok) {
      // A full refresh so the new session cookie is picked up by the server.
      router.replace(state.data.redirectTo);
      router.refresh();
    } else if (state && !state.ok) {
      setDigits(Array(CODE_LENGTH).fill(""));
      inputRefs.current[0]?.focus();
    }
  }, [state, router]);

  const setDigit = (index: number, value: string) => {
    const clean = value.replace(/\D/g, "");
    if (!clean) {
      setDigits((current) => {
        const next = [...current];
        next[index] = "";
        return next;
      });
      return;
    }
    setDigits((current) => {
      const next = [...current];
      let cursor = index;
      for (const char of clean) {
        if (cursor >= CODE_LENGTH) break;
        next[cursor] = char;
        cursor += 1;
      }
      requestAnimationFrame(() => {
        const focusIndex = Math.min(cursor, CODE_LENGTH - 1);
        inputRefs.current[focusIndex]?.focus();
        inputRefs.current[focusIndex]?.select();
      });
      return next;
    });
  };

  const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (event.key === "ArrowRight" && index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  return (
    <Card className="border border-emerald-500/20 bg-white/95 shadow-2xl backdrop-blur">
      <CardContent className="pt-6">
        <form ref={formRef} action={formAction} className="space-y-6">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <input type="hidden" name="accessCode" value={code} />

          <div className="text-center space-y-1">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-700">
              Enter Access Code
            </h2>
            <p className="text-xs text-slate-500">
              Enter your 6-digit staff security code
            </p>
          </div>

          {state && !state.ok ? (
            <div className="animate-shake">
              <FormError message={state.error} />
            </div>
          ) : null}

          <div className="flex justify-center gap-2" role="group" aria-label="Access code">
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(el) => {
                  inputRefs.current[index] = el;
                }}
                type="password"
                inputMode="numeric"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                autoFocus={index === 0}
                maxLength={CODE_LENGTH}
                value={digit}
                onChange={(event) => setDigit(index, event.target.value)}
                onKeyDown={(event) => handleKeyDown(index, event)}
                onFocus={(event) => event.target.select()}
                className={cn(
                  "h-14 w-11 rounded-xl border border-slate-200 bg-slate-50/50 text-center text-2xl font-bold tracking-widest text-slate-900 shadow-sm transition-all",
                  "focus:border-emerald-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30",
                  digit && "border-emerald-600 bg-emerald-50/30 text-emerald-950",
                )}
                aria-label={`Digit ${index + 1}`}
              />
            ))}
          </div>

          <SubmitButton className="h-12 w-full text-base bg-[#0a3b2c] hover:bg-[#06261c] text-white shadow-lg shadow-emerald-950/20" disabled={!complete}>
            Continue
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
