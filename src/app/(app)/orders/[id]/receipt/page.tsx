import { notFound } from "next/navigation";

import { PERMISSIONS } from "@/lib/rbac";
import { assertBranchAccess, assertFirmAccess, requirePermission } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTagSheet } from "@/lib/services/tags";

import { ReceiptStudio } from "./receipt-studio";

export const metadata = { title: "Print receipt" };

export default async function OrderReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePermission(PERMISSIONS.BILLING_VIEW);

  const owner = await prisma.order.findUnique({
    where: { id },
    select: { branchId: true, firmId: true },
  });
  if (!owner) notFound();
  assertBranchAccess(user, owner.branchId);
  assertFirmAccess(user, owner.firmId);

  const sheet = await getTagSheet(id);
  return <ReceiptStudio sheet={sheet} />;
}
