import Link from "next/link";
import type { ReactNode } from "react";

import { getPortalCustomer } from "@/lib/portal-session";
import { portalSignOutAction } from "@/app/portal/actions";

/** Customer-facing shell: the firm's own name, three tabs, nothing else. */
export default async function PortalLayout({ children }: { children: ReactNode }) {
  const customer = await getPortalCustomer();
  return (
    <div className="min-h-dvh bg-background pb-20">
      {customer ? (
        <>
          <header className="border-b bg-card px-4 py-3">
            <div className="mx-auto flex max-w-2xl items-center justify-between">
              <div>
                <p className="text-sm font-semibold">{customer.firm.name}</p>
                <p className="text-xs text-muted-foreground">Hello, {customer.name}</p>
              </div>
              <form action={portalSignOutAction}>
                <button className="text-xs text-muted-foreground underline" type="submit">Sign out</button>
              </form>
            </div>
          </header>
          <main className="mx-auto max-w-2xl px-4 py-5">{children}</main>
          <nav className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-center justify-around border-t bg-card text-xs font-medium">
            <Link href="/portal" className="flex-1 py-2 text-center">My Orders</Link>
            <Link href="/portal/payments" className="flex-1 py-2 text-center">Payments</Link>
            <Link href="/portal/support" className="flex-1 py-2 text-center">Support</Link>
          </nav>
        </>
      ) : (
        <main>{children}</main>
      )}
    </div>
  );
}
