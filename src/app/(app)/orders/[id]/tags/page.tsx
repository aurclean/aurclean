import { notFound } from "next/navigation";

import { PERMISSIONS } from "@/lib/rbac";
import { assertBranchAccess, assertFirmAccess, requirePermission } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTagSheet } from "@/lib/services/tags";

import { TagStudio } from "./tag-studio";

export const metadata = { title: "Print tags" };

export default async function OrderTagsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePermission(PERMISSIONS.GARMENT_VIEW);

  const owner = await prisma.order.findUnique({
    where: { id },
    select: { branchId: true, firmId: true },
  });
  if (!owner) notFound();
  assertBranchAccess(user, owner.branchId);
  assertFirmAccess(user, owner.firmId);

  const sheet = await getTagSheet(id);
  return <TagStudio sheet={sheet} />;
}
