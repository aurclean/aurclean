import { formatDateTime } from "@/lib/dates";
import type { JobView } from "@/app/(app)/field/job-card";

type Row = {
  id: string;
  status: string;
  scheduledAt: Date;
  contactName: string;
  contactPhone: string;
  addressLine: string;
  landmark: string | null;
  notes: string | null;
  failureReason: string | null;
  order: { orderNumber: string };
};

export function toJobViews(
  pickups: Array<Row & { pickupNumber: string }>,
  deliveries: Array<Row & { deliveryNumber: string }>,
): JobView[] {
  const base = (r: Row) => ({
    id: r.id,
    orderNumber: r.order.orderNumber,
    status: r.status,
    scheduledLabel: formatDateTime(r.scheduledAt),
    contactName: r.contactName,
    contactPhone: r.contactPhone,
    addressLine: r.addressLine,
    landmark: r.landmark,
    notes: r.notes,
    failureReason: r.failureReason,
  });
  return [
    ...pickups.map((p) => ({ ...base(p), kind: "pickup" as const, number: p.pickupNumber, sort: p.scheduledAt.getTime() })),
    ...deliveries.map((d) => ({ ...base(d), kind: "delivery" as const, number: d.deliveryNumber, sort: d.scheduledAt.getTime() })),
  ]
    .sort((a, b) => a.sort - b.sort)
    .map(({ sort: _sort, ...job }) => job);
}
