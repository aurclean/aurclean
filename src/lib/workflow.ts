import type {
  ChallanStatus,
  GarmentStatus,
  OrderStatus,
  ProcessingStage,
  TaskStatus,
} from "@/generated/prisma/enums";

/** Canonical shop-floor pipeline, in the order work physically happens. */
export const STAGE_ORDER: ProcessingStage[] = [
  "RECEIVING",
  "SORTING",
  "WASHING",
  "DRYING",
  "IRONING",
  "QUALITY_CHECK",
  "PACKING",
  "DISPATCH",
];

export const STAGE_LABELS: Record<ProcessingStage, string> = {
  RECEIVING: "Receiving",
  SORTING: "Sorting",
  WASHING: "Washing",
  DRYING: "Drying",
  IRONING: "Ironing",
  QUALITY_CHECK: "Quality Control",
  PACKING: "Packing",
  DISPATCH: "Dispatch",
};

/** Stages that have a dedicated workstation screen. */
export const WORKSTATION_STAGES: ProcessingStage[] = [
  "SORTING",
  "WASHING",
  "DRYING",
  "IRONING",
  "QUALITY_CHECK",
  "PACKING",
];

/** The outcomes an operator can record at each workstation. */
export const STAGE_OUTCOMES: Record<ProcessingStage, TaskStatus[]> = {
  RECEIVING: ["COMPLETED"],
  SORTING: ["IN_PROGRESS", "COMPLETED"],
  WASHING: ["IN_PROGRESS", "COMPLETED", "REWASH"],
  DRYING: ["IN_PROGRESS", "COMPLETED"],
  IRONING: ["IN_PROGRESS", "COMPLETED", "REWORK"],
  QUALITY_CHECK: ["IN_PROGRESS", "PASSED", "FAILED"],
  PACKING: ["IN_PROGRESS", "COMPLETED"],
  DISPATCH: ["COMPLETED"],
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  PASSED: "Passed",
  FAILED: "Failed",
  REWASH: "Rewash",
  REWORK: "Rework",
  SKIPPED: "Skipped",
};

/** The garment status implied by a task sitting at a given stage and state. */
export function garmentStatusFor(
  stage: ProcessingStage,
  taskStatus: TaskStatus,
): GarmentStatus {
  const map: Record<ProcessingStage, Partial<Record<TaskStatus, GarmentStatus>>> = {
    RECEIVING: { PENDING: "RECEIVED", COMPLETED: "RECEIVED" },
    SORTING: { PENDING: "RECEIVED", IN_PROGRESS: "SORTING", COMPLETED: "SORTED" },
    WASHING: {
      PENDING: "SORTED",
      IN_PROGRESS: "WASHING",
      COMPLETED: "WASHED",
      REWASH: "REWASH",
    },
    DRYING: { PENDING: "WASHED", IN_PROGRESS: "DRYING", COMPLETED: "DRIED" },
    IRONING: {
      PENDING: "DRIED",
      IN_PROGRESS: "IRONING",
      COMPLETED: "IRONED",
      REWORK: "REWORK",
    },
    QUALITY_CHECK: {
      PENDING: "QC_PENDING",
      IN_PROGRESS: "QC_PENDING",
      PASSED: "QC_PASSED",
      FAILED: "QC_FAILED",
    },
    PACKING: { PENDING: "IRONED", IN_PROGRESS: "PACKING", COMPLETED: "PACKED" },
    DISPATCH: { PENDING: "READY", COMPLETED: "DELIVERED" },
  };

  return map[stage][taskStatus] ?? "RECEIVED";
}

/** Where a garment goes when a QC failure or a rewash sends it backwards. */
export const REMEDIATION_TARGET: Partial<Record<ProcessingStage, ProcessingStage>> = {
  WASHING: "WASHING",
  IRONING: "IRONING",
  QUALITY_CHECK: "WASHING",
};

export function nextStage(
  stage: ProcessingStage,
  pipeline: ProcessingStage[],
): ProcessingStage | null {
  const index = pipeline.indexOf(stage);
  if (index === -1 || index === pipeline.length - 1) return null;
  return pipeline[index + 1];
}

/**
 * The counter-facing flow. Sorting and quality control are real workstations a
 * service can opt into, but they are not part of the standard route a walk-in
 * order takes, so the order screens describe progress in these seven steps.
 */
export const POS_FLOW = [
  "Received",
  "Washing",
  "Drying",
  "Ironing",
  "Packing",
  "Ready",
  "Delivered",
] as const;

/** Stages a service gets when it does not name its own. */
export const DEFAULT_SERVICE_STAGES: ProcessingStage[] = [
  "WASHING",
  "DRYING",
  "IRONING",
  "PACKING",
];

/**
 * Builds the stage pipeline a garment must travel, honouring the stages
 * configured on its service and always ending at dispatch.
 */
export function buildPipeline(serviceStages: ProcessingStage[]): ProcessingStage[] {
  const configured = new Set<ProcessingStage>(
    serviceStages.length > 0 ? serviceStages : DEFAULT_SERVICE_STAGES,
  );
  configured.add("PACKING");
  return STAGE_ORDER.filter(
    (stage) => stage !== "RECEIVING" && stage !== "DISPATCH" && configured.has(stage),
  );
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  RECEIVED: "Received",
  SORTING: "Sorting",
  WASHING: "Washing",
  DRYING: "Drying",
  IRONING: "Ironing",
  QUALITY_CHECK: "Quality Check",
  PACKING: "Packing",
  READY: "Ready",
  OUT_FOR_DELIVERY: "Out for Delivery",
  PARTIALLY_DELIVERED: "Partially Delivered",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  ON_HOLD: "On Hold",
};

export const GARMENT_STATUS_LABELS: Record<GarmentStatus, string> = {
  RECEIVED: "Received",
  SORTING: "Sorting",
  SORTED: "Sorted",
  WASHING: "Washing",
  WASHED: "Washed",
  DRYING: "Drying",
  DRIED: "Dried",
  IRONING: "Ironing",
  IRONED: "Ironed",
  QC_PENDING: "QC Pending",
  QC_PASSED: "QC Passed",
  QC_FAILED: "QC Failed",
  REWASH: "Rewash",
  REWORK: "Rework",
  PACKING: "Packing",
  PACKED: "Packed",
  READY: "Ready",
  OUT_FOR_DELIVERY: "Out for Delivery",
  DELIVERED: "Delivered",
  LOST: "Lost",
  DAMAGED: "Damaged",
  RETURNED: "Returned",
};

/** The order status implied by the least-advanced garment in the order. */
export function orderStatusForStage(
  stage: ProcessingStage,
  taskStatus: TaskStatus,
): OrderStatus {
  switch (stage) {
    case "RECEIVING":
      return "RECEIVED";
    case "SORTING":
      return "SORTING";
    case "WASHING":
      return "WASHING";
    case "DRYING":
      return "DRYING";
    case "IRONING":
      return "IRONING";
    case "QUALITY_CHECK":
      return "QUALITY_CHECK";
    case "PACKING":
      return taskStatus === "COMPLETED" ? "READY" : "PACKING";
    case "DISPATCH":
      return taskStatus === "COMPLETED" ? "DELIVERED" : "OUT_FOR_DELIVERY";
    default:
      return "RECEIVED";
  }
}

/** Statuses an order can never move out of without an explicit reopen. */
export const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
];

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  RECEIVED: ["SORTING", "ON_HOLD", "CANCELLED"],
  SORTING: ["WASHING", "IRONING", "ON_HOLD", "CANCELLED"],
  WASHING: ["DRYING", "IRONING", "ON_HOLD", "CANCELLED"],
  DRYING: ["IRONING", "QUALITY_CHECK", "ON_HOLD", "CANCELLED"],
  IRONING: ["QUALITY_CHECK", "PACKING", "ON_HOLD", "CANCELLED"],
  QUALITY_CHECK: ["PACKING", "WASHING", "IRONING", "ON_HOLD", "CANCELLED"],
  PACKING: ["READY", "ON_HOLD", "CANCELLED"],
  READY: ["OUT_FOR_DELIVERY", "DELIVERED", "PARTIALLY_DELIVERED", "ON_HOLD", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "PARTIALLY_DELIVERED", "READY", "ON_HOLD"],
  PARTIALLY_DELIVERED: ["DELIVERED", "OUT_FOR_DELIVERY", "ON_HOLD"],
  DELIVERED: ["REFUNDED"],
  CANCELLED: [],
  REFUNDED: [],
  ON_HOLD: ["RECEIVED", "SORTING", "WASHING", "DRYING", "IRONING", "QUALITY_CHECK", "PACKING", "READY", "CANCELLED"],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true;
  return ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Statuses that mean the order is still being worked on. */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  "RECEIVED",
  "SORTING",
  "WASHING",
  "DRYING",
  "IRONING",
  "QUALITY_CHECK",
  "PACKING",
];

export const PROCESSING_ORDER_STATUSES: OrderStatus[] = [
  "SORTING",
  "WASHING",
  "DRYING",
  "IRONING",
  "QUALITY_CHECK",
  "PACKING",
];

export type BadgeTone =
  | "neutral"
  | "info"
  | "progress"
  | "success"
  | "warning"
  | "danger";

export const ORDER_STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  RECEIVED: "info",
  SORTING: "progress",
  WASHING: "progress",
  DRYING: "progress",
  IRONING: "progress",
  QUALITY_CHECK: "warning",
  PACKING: "progress",
  READY: "success",
  OUT_FOR_DELIVERY: "info",
  PARTIALLY_DELIVERED: "warning",
  DELIVERED: "success",
  CANCELLED: "danger",
  REFUNDED: "danger",
  ON_HOLD: "warning",
};

export const GARMENT_STATUS_TONE: Record<GarmentStatus, BadgeTone> = {
  RECEIVED: "info",
  SORTING: "progress",
  SORTED: "progress",
  WASHING: "progress",
  WASHED: "progress",
  DRYING: "progress",
  DRIED: "progress",
  IRONING: "progress",
  IRONED: "progress",
  QC_PENDING: "warning",
  QC_PASSED: "success",
  QC_FAILED: "danger",
  REWASH: "danger",
  REWORK: "danger",
  PACKING: "progress",
  PACKED: "success",
  READY: "success",
  OUT_FOR_DELIVERY: "info",
  DELIVERED: "success",
  LOST: "danger",
  DAMAGED: "danger",
  RETURNED: "warning",
};

export const TASK_STATUS_TONE: Record<TaskStatus, BadgeTone> = {
  PENDING: "neutral",
  IN_PROGRESS: "progress",
  COMPLETED: "success",
  PASSED: "success",
  FAILED: "danger",
  REWASH: "danger",
  REWORK: "danger",
  SKIPPED: "neutral",
};

export const CHALLAN_STATUS_TONE: Record<ChallanStatus, BadgeTone> = {
  DRAFT: "neutral",
  GENERATED: "info",
  READY_FOR_DELIVERY: "warning",
  PARTIALLY_DELIVERED: "progress",
  DELIVERED: "success",
  CANCELLED: "danger",
};

export const CHALLAN_STATUS_LABELS: Record<ChallanStatus, string> = {
  DRAFT: "Draft",
  GENERATED: "Generated",
  READY_FOR_DELIVERY: "Ready for Delivery",
  PARTIALLY_DELIVERED: "Partially Delivered",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export const PAYMENT_STATUS_TONE: Record<string, BadgeTone> = {
  UNPAID: "danger",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  REFUNDED: "neutral",
  PARTIALLY_REFUNDED: "warning",
  OVERDUE: "danger",
};

export const DELIVERY_STATUS_TONE: Record<string, BadgeTone> = {
  PENDING: "neutral",
  DRIVER_ASSIGNED: "info",
  OUT_FOR_DELIVERY: "progress",
  DELIVERED: "success",
  FAILED: "danger",
  RESCHEDULED: "warning",
  CANCELLED: "danger",
  REQUESTED: "neutral",
  DRIVER_ACCEPTED: "info",
  PICKED_UP: "progress",
  RECEIVED_AT_LAUNDRY: "success",
};

export const GENERIC_TONE: Record<string, BadgeTone> = {
  ACTIVE: "success",
  INACTIVE: "neutral",
  SUSPENDED: "danger",
  DRAFT: "neutral",
  SENT: "info",
  PARTIALLY_RECEIVED: "warning",
  RECEIVED: "success",
  CLOSED: "neutral",
  ISSUED: "info",
  PAID: "success",
  UNPAID: "danger",
  PARTIALLY_PAID: "warning",
  OVERDUE: "danger",
  CANCELLED: "danger",
  OPEN: "warning",
  UNDER_INVESTIGATION: "progress",
  AWAITING_CUSTOMER: "info",
  RESOLVED: "success",
  REJECTED: "danger",
  PENDING: "neutral",
  APPROVED: "success",
  PROCESSED: "success",
  REQUESTED: "info",
  FAILED: "danger",
  QUEUED: "info",
  DELIVERED: "success",
  READ: "success",
  EXPIRED: "neutral",
  TERMINATED: "danger",
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "danger",
  NORMAL: "neutral",
  EXPRESS: "warning",
  URGENT: "danger",
  PRESENT: "success",
  ABSENT: "danger",
  HALF_DAY: "warning",
  LEAVE: "info",
  WEEKLY_OFF: "neutral",
  HOLIDAY: "neutral",
};

export function toneFor(value: string | null | undefined): BadgeTone {
  if (!value) return "neutral";
  return (
    ORDER_STATUS_TONE[value as OrderStatus] ??
    GARMENT_STATUS_TONE[value as GarmentStatus] ??
    TASK_STATUS_TONE[value as TaskStatus] ??
    DELIVERY_STATUS_TONE[value] ??
    CHALLAN_STATUS_TONE[value as ChallanStatus] ??
    GENERIC_TONE[value] ??
    "neutral"
  );
}
