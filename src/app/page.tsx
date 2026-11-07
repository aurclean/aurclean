import { redirect } from "next/navigation";

import { ROLE_LANDING_PATH } from "@/lib/rbac";
import { requireUser } from "@/lib/session";

export default async function HomePage() {
  const user = await requireUser();
  redirect(ROLE_LANDING_PATH[user.role]);
}
