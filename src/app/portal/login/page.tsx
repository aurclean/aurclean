import { PortalLoginForm } from "@/app/portal/login/login-form";

export const metadata = { title: "Customer sign-in" };

export default function PortalLoginPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-bold">Track your orders</h1>
        <p className="text-sm text-muted-foreground">We will send a one-time code to your WhatsApp number.</p>
      </div>
      <PortalLoginForm />
    </div>
  );
}
