import { notFound } from "next/navigation";
import { assertFirmAccess, requirePermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import { getDeliveryChallanById } from "@/lib/services/delivery-challan";
import { ChallanDetailsClient } from "./challan-details-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const challan = await getDeliveryChallanById(id);
  if (!challan) return { title: "Delivery Challan Not Found" };
  return {
    title: `Delivery Challan ${challan.challanNumber} — AURCLEAN Laundry ERP`,
  };
}

export default async function DeliveryChallanDetailPage({ params }: PageProps) {
  const user = await requirePermission(PERMISSIONS.DELIVERY_VIEW);
  const { id } = await params;

  const challan = await getDeliveryChallanById(id);
  if (!challan) {
    notFound();
  }
  assertFirmAccess(user, challan.firmId);

  return <ChallanDetailsClient challan={challan} />;
}
