import type { NotificationEvent } from "@/generated/prisma/enums";

/**
 * Fallback wording used when no active template exists for an event. Kept free
 * of server-only imports so the seed and any tooling can read it too.
 */
export const DEFAULT_NOTIFICATION_BODIES: Record<NotificationEvent, string> = {
  ORDER_RECEIVED:
    "Hi {{customerName}}, we have received your order {{orderNumber}} ({{pieces}} items). Expected delivery: {{expectedDelivery}}. — {{brand}}",
  PROCESSING_STARTED:
    "Hi {{customerName}}, processing has started on order {{orderNumber}}. We will notify you once it is ready. — {{brand}}",
  ORDER_READY:
    "Good news {{customerName}}! Order {{orderNumber}} is ready for collection. Amount due: {{outstanding}}. — {{brand}}",
  OUT_FOR_DELIVERY:
    "Hi {{customerName}}, order {{orderNumber}} is out for delivery. Please keep {{outstanding}} ready. — {{brand}}",
  DELIVERED:
    "Order {{orderNumber}} has been delivered. Thank you for choosing {{brand}}!",
  PAYMENT_RECEIVED:
    "Payment of {{amount}} received for order {{orderNumber}}. Outstanding: {{outstanding}}. — {{brand}}",
  PAYMENT_REMINDER:
    "Reminder: {{outstanding}} is pending on order {{orderNumber}}. Kindly clear the balance. — {{brand}}",
  ORDER_DELAYED:
    "We are sorry — order {{orderNumber}} is running late. Our team is on it and will update you shortly. — {{brand}}",
  PICKUP_SCHEDULED:
    "Hi {{customerName}}, your pickup for order {{orderNumber}} is scheduled for {{scheduledAt}}. — {{brand}}",
  COMPLAINT_REGISTERED:
    "We have registered your complaint {{complaintNumber}} for order {{orderNumber}}. We will get back to you shortly. — {{brand}}",
  COMPLAINT_RESOLVED:
    "Your complaint {{complaintNumber}} has been resolved. Thank you for your patience. — {{brand}}",
};

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEvent, string> = {
  ORDER_RECEIVED: "Order received",
  PROCESSING_STARTED: "Processing started",
  ORDER_READY: "Order ready",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  PAYMENT_RECEIVED: "Payment received",
  PAYMENT_REMINDER: "Payment reminder",
  ORDER_DELAYED: "Order delayed",
  PICKUP_SCHEDULED: "Pickup scheduled",
  COMPLAINT_REGISTERED: "Complaint registered",
  COMPLAINT_RESOLVED: "Complaint resolved",
};
