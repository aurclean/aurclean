import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { LoginForm } from "@/app/login/login-form";
import { AurcleanLogo } from "@/components/shared/aurclean-logo";

export const metadata = { title: "Welcome to AURCLEAN — Access Code" };

export default function LoginPage() {
  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-gradient-to-br from-[#041d16] via-[#0a3b2c] to-[#06261c] px-4 py-12 overflow-hidden">
      {/* Subtle branded background glow elements */}
      <div className="absolute -top-40 -left-40 size-96 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 size-96 rounded-full bg-emerald-400/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-md space-y-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="relative flex items-center justify-center p-3 rounded-full bg-emerald-500/10 border border-emerald-500/20 backdrop-blur-md shadow-[0_0_40px_rgba(16,185,129,0.2)]">
            <AurcleanLogo size="2xl" variant="icon" />
          </div>
          <div className="space-y-1 mt-1">
            <h1 className="text-3xl font-black tracking-tight text-white flex items-center justify-center gap-1">
              <span>AUR</span><span className="text-emerald-400">CLEAN</span>
            </h1>
            <p className="text-xs font-bold text-emerald-300/90 uppercase tracking-[0.2em]">
              Laundry Operations & ERP System
            </p>
          </div>
        </div>

        <Suspense fallback={<Skeleton className="h-48 w-full rounded-2xl bg-emerald-950/40" />}>
          <LoginForm />
        </Suspense>

        <p className="text-center text-xs text-emerald-300/60">
          Lost your code? Ask a Super Admin to look it up in Staff.
        </p>
      </div>
    </div>
  );
}
