"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestOtpAction, verifyOtpAction } from "@/app/portal/actions";

export function PortalLoginForm() {
  const router = useRouter();
  const [firmCode, setFirmCode] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"request" | "verify">("request");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      {error ? <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      {message ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{message}</p> : null}

      <Input placeholder="Firm code (printed on your bill)" value={firmCode} onChange={(e) => setFirmCode(e.target.value.toUpperCase())} autoCapitalize="characters" />
      <Input placeholder="Mobile number" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />

      {step === "verify" ? (
        <Input placeholder="6-digit code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" />
      ) : null}

      <Button
        className="w-full"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            if (step === "request") {
              const result = await requestOtpAction({ firmCode, phone });
              if (result.ok) {
                setMessage(result.message);
                setStep("verify");
              } else setError(result.message);
            } else {
              const result = await verifyOtpAction({ firmCode, phone, code });
              if (result.ok) {
                router.replace("/portal");
                router.refresh();
              } else setError(result.message);
            }
          })
        }
      >
        {step === "request" ? "Send code on WhatsApp" : "Sign in"}
      </Button>
      {step === "verify" ? (
        <button type="button" className="w-full text-xs text-muted-foreground underline" onClick={() => { setStep("request"); setCode(""); setMessage(null); }}>
          Send a new code
        </button>
      ) : null}
    </div>
  );
}
