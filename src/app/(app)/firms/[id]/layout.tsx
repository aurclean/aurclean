import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { FirmTabs } from "@/app/(app)/firms/[id]/firm-tabs";

export default async function FirmLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  await requirePermission(PERMISSIONS.FIRM_VIEW);
  const { id } = await params;
  const firm = await prisma.firm.findUnique({ where: { id }, select: { id: true } });
  if (!firm) notFound();
  return (
    <div className="space-y-5">
      <FirmTabs firmId={firm.id} />
      {children}
    </div>
  );
}
