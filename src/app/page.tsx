import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ROLE_LANDING_PATH } from "@/lib/rbac";
import { getCurrentUser } from "@/lib/session";

export default async function HomePage() {
  const session = await auth();
  if (session?.user?.role === "CUSTOMER") redirect(ROLE_LANDING_PATH.CUSTOMER);
  const user = await getCurrentUser();
  // A revoked/deactivated staff session lands here with a still-valid cookie:
  // send it to sign-in (the login page does not bounce an unauthenticated user).
  if (!user) redirect("/login?expired=1");
  redirect(ROLE_LANDING_PATH[user.role]);
}
