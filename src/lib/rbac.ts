import type { UserRole } from "@/generated/prisma/enums";

/**
 * Permission catalogue. Every server action and route handler authorises against
 * one of these codes — never against a role directly — so that per-user grants
 * and revocations can override the role defaults.
 */
export const PERMISSIONS = {
  // Dashboard & analytics
  DASHBOARD_VIEW: "dashboard.view",
  DASHBOARD_VIEW_FINANCIALS: "dashboard.view_financials",
  DASHBOARD_VIEW_ALL_BRANCHES: "dashboard.view_all_branches",

  // Orders
  ORDER_VIEW: "orders.view",
  ORDER_CREATE: "orders.create",
  ORDER_UPDATE: "orders.update",
  ORDER_DELETE: "orders.delete",
  ORDER_CANCEL: "orders.cancel",
  ORDER_OVERRIDE_PRICE: "orders.override_price",
  ORDER_APPLY_DISCOUNT: "orders.apply_discount",

  // Garments
  GARMENT_VIEW: "garments.view",
  GARMENT_SCAN: "garments.scan",
  GARMENT_UPDATE: "garments.update",
  GARMENT_PHOTO_UPLOAD: "garments.photo_upload",

  // Processing
  PROCESSING_VIEW: "processing.view",
  PROCESSING_SORTING: "processing.sorting",
  PROCESSING_WASHING: "processing.washing",
  PROCESSING_DRYING: "processing.drying",
  PROCESSING_IRONING: "processing.ironing",
  PROCESSING_QC: "processing.qc",
  PROCESSING_PACKING: "processing.packing",

  // Delivery
  DELIVERY_VIEW: "delivery.view",
  DELIVERY_MANAGE: "delivery.manage",
  DELIVERY_ASSIGN_DRIVER: "delivery.assign_driver",
  DELIVERY_COLLECT_PAYMENT: "delivery.collect_payment",

  // Billing / Payments
  BILLING_VIEW: "billing.view",
  BILLING_CREATE_INVOICE: "billing.create_invoice",
  BILLING_RECORD_PAYMENT: "billing.record_payment",
  BILLING_REFUND: "billing.refund",

  // Inventory
  INVENTORY_VIEW: "inventory.view",
  INVENTORY_MANAGE: "inventory.manage",
  INVENTORY_TRANSFER: "inventory.transfer",
  INVENTORY_ADJUST: "inventory.adjust",

  // Garment tracking & mismatch detection
  TRACKING_VIEW: "tracking.view",
  TRACKING_RESOLVE: "tracking.resolve",

  // Customers
  CUSTOMER_VIEW: "customers.view",
  CUSTOMER_MANAGE: "customers.manage",

  // Purchases
  PURCHASE_VIEW: "purchases.view",
  PURCHASE_MANAGE: "purchases.manage",
  PURCHASE_PAY: "purchases.pay",

  // B2B
  B2B_VIEW: "b2b.view",
  B2B_MANAGE: "b2b.manage",
  B2B_BILLING: "b2b.billing",

  // Staff
  STAFF_VIEW: "staff.view",
  STAFF_MANAGE: "staff.manage",
  STAFF_ATTENDANCE: "staff.attendance",
  STAFF_APPROVE_LEAVE: "staff.approve_leave",

  // Complaints
  COMPLAINT_VIEW: "complaints.view",
  COMPLAINT_CREATE: "complaints.create",
  COMPLAINT_MANAGE: "complaints.manage",
  COMPLAINT_RESOLVE: "complaints.resolve",

  // Reports
  REPORT_VIEW: "reports.view",
  REPORT_SALES: "reports.sales",
  REPORT_OPERATIONS: "reports.operations",
  REPORT_FINANCE: "reports.finance",
  REPORT_EXPORT: "reports.export",

  // Notifications
  NOTIFICATION_VIEW: "notifications.view",
  NOTIFICATION_MANAGE: "notifications.manage",

  // Expenses
  EXPENSE_VIEW: "expenses.view",
  EXPENSE_MANAGE: "expenses.manage",
  EXPENSE_APPROVE: "expenses.approve",

  // Settings & administration
  BRANCH_VIEW: "branches.view",
  BRANCH_MANAGE: "branches.manage",
  CATALOGUE_MANAGE: "catalogue.manage",
  SETTINGS_MANAGE: "settings.manage",
  AUDIT_VIEW: "audit.view",

  // Finance ERP Engine
  FINANCE_VIEW: "finance.view",
  FINANCE_MANAGE: "finance.manage",
  BANK_MANAGE: "bank.manage",
  RECONCILE_MANAGE: "reconcile.manage",
  DATA_IMPORT_EXPORT: "data.import_export",

  // Per-firm WhatsApp account management (connect / QR / disconnect / logs)
  WHATSAPP_MANAGE: "whatsapp.manage",

  // Quality control (QC role) and assigned field jobs (Field Manager role)
  QC_VIEW: "qc.view",
  QC_PERFORM: "qc.perform",
  FIELD_JOBS: "field.jobs",

  // Platform (cross-firm) administration — PLATFORM_ADMIN only, never
  // granted within a firm's own role set.
  FIRM_VIEW: "firm.view",
  FIRM_MANAGE: "firm.manage",
  PLATFORM_VIEW: "platform.view",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_MODULES: Record<PermissionCode, string> = Object.values(
  PERMISSIONS,
).reduce(
  (acc, code) => {
    acc[code] = code.split(".")[0];
    return acc;
  },
  {} as Record<PermissionCode, string>,
);

const P = PERMISSIONS;

const ALL_PERMISSIONS = Object.values(PERMISSIONS) as PermissionCode[];

/**
 * Cross-firm platform permissions. These live in the same PERMISSIONS map as
 * every operational permission, so ALL_PERMISSIONS (Object.values of that
 * map) picks them up automatically — which would otherwise silently hand
 * every ordinary Firm Admin (SUPER_ADMIN, a per-firm role) access to the
 * Firms module for every other firm too. Excluded from SUPER_ADMIN's grant
 * below; only PLATFORM_ADMIN gets them.
 */
const PLATFORM_ONLY_PERMISSIONS: PermissionCode[] = [P.FIRM_VIEW, P.FIRM_MANAGE, P.PLATFORM_VIEW];

/**
 * FIELD_MANAGER: assigned pickup and delivery jobs only. Deliberately has no
 * orders/customers/billing/delivery-module permission — everything it can see
 * is served by the /field pages, which query ONLY jobs assigned to the user.
 */
const FIELD_MANAGER_PERMISSIONS: PermissionCode[] = [P.FIELD_JOBS, P.GARMENT_PHOTO_UPLOAD];

/**
 * QC: the inspection queue plus the garment scan/update needed to pass, fail
 * or send an item for rework. No financial, staff, settings or customer
 * directory access.
 */
const QC_PERMISSIONS: PermissionCode[] = [
  P.QC_VIEW,
  P.QC_PERFORM,
  P.GARMENT_VIEW,
  P.GARMENT_SCAN,
  P.GARMENT_UPDATE,
  P.GARMENT_PHOTO_UPLOAD,
  // Floor staff who were "Scanners" before the five-role model keep operating
  // the processing stations (rework happens at these stations).
  P.PROCESSING_VIEW,
  P.PROCESSING_SORTING,
  P.PROCESSING_WASHING,
  P.PROCESSING_DRYING,
  P.PROCESSING_IRONING,
  P.PROCESSING_QC,
  P.PROCESSING_PACKING,
  P.TRACKING_VIEW,
];

/** Permissions that only the platform-level role holds. */
const FIRM_MANAGER_EXCLUDED: PermissionCode[] = [
  ...PLATFORM_ONLY_PERMISSIONS,
  P.FIELD_JOBS,
];

/**
 * Default role → permission matrix, synced into role_permissions by
 * `npm run db:sync-permissions`.
 *
 * PLATFORM_SUPER_ADMIN holds every permission, but only exercises the
 * operational ones after explicitly "entering" a firm (session.activeFirmId);
 * with no firm entered, operational pages have nothing to scope to.
 * CUSTOMER has no staff permissions at all: the customer portal is gated by
 * the customer's own session, never by this matrix.
 */
export const ROLE_PERMISSIONS: Record<UserRole, PermissionCode[]> = {
  PLATFORM_SUPER_ADMIN: [...new Set([...ALL_PERMISSIONS, ...PLATFORM_ONLY_PERMISSIONS])],
  FIRM_MANAGER: ALL_PERMISSIONS.filter((code) => !FIRM_MANAGER_EXCLUDED.includes(code)),
  FIELD_MANAGER: [...new Set(FIELD_MANAGER_PERMISSIONS)],
  QC: [...new Set(QC_PERMISSIONS)],
  CUSTOMER: [],
};

/** Roles that may see data across every branch (still bounded to their own firm) rather than just their own branch. */
export const GLOBAL_ROLES: UserRole[] = ["PLATFORM_SUPER_ADMIN", "FIRM_MANAGER"];

export function isGlobalRole(role: UserRole): boolean {
  return GLOBAL_ROLES.includes(role);
}

/** True cross-firm role — the only one that can operate without a firm selected. */
export function isPlatformRole(role: UserRole): boolean {
  return role === "PLATFORM_SUPER_ADMIN";
}

export function defaultPermissionsFor(role: UserRole): PermissionCode[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export const ROLE_LABELS: Record<UserRole, string> = {
  PLATFORM_SUPER_ADMIN: "Platform Super Admin",
  FIRM_MANAGER: "Firm Manager",
  FIELD_MANAGER: "Field Manager",
  QC: "QC",
  CUSTOMER: "Customer",
};

/** Staff roles a Firm Manager may create (never another manager, never platform). */
export const STAFF_ROLES: UserRole[] = ["FIELD_MANAGER", "QC"];

/** Where a user of this role should land right after login. */
export const ROLE_LANDING_PATH: Record<UserRole, string> = {
  PLATFORM_SUPER_ADMIN: "/platform",
  FIRM_MANAGER: "/dashboard",
  FIELD_MANAGER: "/field",
  QC: "/qc",
  CUSTOMER: "/portal",
};

export const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  [P.DASHBOARD_VIEW]: "View the operational dashboard",
  [P.DASHBOARD_VIEW_FINANCIALS]: "See revenue and outstanding figures on the dashboard",
  [P.DASHBOARD_VIEW_ALL_BRANCHES]: "See data for every branch, not just the assigned one",
  [P.ORDER_VIEW]: "View orders",
  [P.ORDER_CREATE]: "Create new orders",
  [P.ORDER_UPDATE]: "Edit orders and advance their status",
  [P.ORDER_DELETE]: "Delete orders",
  [P.ORDER_CANCEL]: "Cancel orders",
  [P.ORDER_OVERRIDE_PRICE]: "Override calculated prices",
  [P.ORDER_APPLY_DISCOUNT]: "Apply discounts to orders",
  [P.GARMENT_VIEW]: "View garments and their history",
  [P.GARMENT_SCAN]: "Scan garment QR codes and barcodes",
  [P.GARMENT_UPDATE]: "Edit garment details and laundry status",
  [P.GARMENT_PHOTO_UPLOAD]: "Upload garment photos",
  [P.TRACKING_VIEW]: "See garment categories and the mismatch centre",
  [P.TRACKING_RESOLVE]: "Report missing garments and clear mismatches",
  [P.CUSTOMER_VIEW]: "View the customer directory and order history",
  [P.CUSTOMER_MANAGE]: "Add and edit customer records",
  [P.PROCESSING_VIEW]: "View processing workstations",
  [P.PROCESSING_SORTING]: "Operate the sorting workstation",
  [P.PROCESSING_WASHING]: "Operate the washing workstation",
  [P.PROCESSING_DRYING]: "Operate the drying workstation",
  [P.PROCESSING_IRONING]: "Operate the ironing workstation",
  [P.PROCESSING_QC]: "Operate quality control",
  [P.PROCESSING_PACKING]: "Operate the packing workstation",
  [P.DELIVERY_VIEW]: "View pickups and deliveries",
  [P.DELIVERY_MANAGE]: "Create and edit pickups and deliveries",
  [P.DELIVERY_ASSIGN_DRIVER]: "Assign drivers to jobs",
  [P.DELIVERY_COLLECT_PAYMENT]: "Collect payment on delivery",
  [P.BILLING_VIEW]: "View invoices and payments",
  [P.BILLING_CREATE_INVOICE]: "Generate invoices",
  [P.BILLING_RECORD_PAYMENT]: "Record payments",
  [P.BILLING_REFUND]: "Issue refunds",
  [P.INVENTORY_VIEW]: "View inventory levels",
  [P.INVENTORY_MANAGE]: "Manage inventory items and stock movements",
  [P.INVENTORY_TRANSFER]: "Transfer stock between branches",
  [P.INVENTORY_ADJUST]: "Adjust stock quantities",
  [P.PURCHASE_VIEW]: "View suppliers and purchase orders",
  [P.PURCHASE_MANAGE]: "Manage suppliers, purchase orders and receipts",
  [P.PURCHASE_PAY]: "Record supplier payments",
  [P.B2B_VIEW]: "View corporate accounts",
  [P.B2B_MANAGE]: "Manage corporate accounts, contracts and rate cards",
  [P.B2B_BILLING]: "Generate corporate statements and invoices",
  [P.STAFF_VIEW]: "View staff records",
  [P.STAFF_MANAGE]: "Create and edit staff records",
  [P.STAFF_ATTENDANCE]: "Record attendance",
  [P.STAFF_APPROVE_LEAVE]: "Approve or reject leave requests",
  [P.COMPLAINT_VIEW]: "View complaints",
  [P.COMPLAINT_CREATE]: "Raise complaints",
  [P.COMPLAINT_MANAGE]: "Investigate and assign complaints",
  [P.COMPLAINT_RESOLVE]: "Resolve complaints and award compensation",
  [P.REPORT_VIEW]: "Open the reports module",
  [P.REPORT_SALES]: "View sales reports",
  [P.REPORT_OPERATIONS]: "View operations reports",
  [P.REPORT_FINANCE]: "View finance reports",
  [P.REPORT_EXPORT]: "Export report data",
  [P.NOTIFICATION_VIEW]: "View notification logs",
  [P.NOTIFICATION_MANAGE]: "Manage notification templates and resend messages",
  [P.EXPENSE_VIEW]: "View expenses",
  [P.EXPENSE_MANAGE]: "Record expenses",
  [P.EXPENSE_APPROVE]: "Approve expenses",
  [P.BRANCH_VIEW]: "View branches",
  [P.BRANCH_MANAGE]: "Create and edit branches",
  [P.CATALOGUE_MANAGE]: "Manage services, garment types and rates",
  [P.SETTINGS_MANAGE]: "Change system settings",
  [P.AUDIT_VIEW]: "View audit logs",
  [P.WHATSAPP_MANAGE]: "Connect, disconnect and view this firm's WhatsApp account and message history",
  [P.QC_VIEW]: "View the QC queue and QC history",
  [P.QC_PERFORM]: "Pass, fail or send garments for rework",
  [P.FIELD_JOBS]: "View and update assigned pickup and delivery jobs",
  [P.FIRM_VIEW]: "View the Firms directory",
  [P.FIRM_MANAGE]: "Create, edit, activate and deactivate firms",
  [P.PLATFORM_VIEW]: "View platform-wide statistics across all firms",
};

/** Maps a processing stage to the permission required to operate it. */
export const STAGE_PERMISSION: Record<string, PermissionCode> = {
  SORTING: P.PROCESSING_SORTING,
  WASHING: P.PROCESSING_WASHING,
  DRYING: P.PROCESSING_DRYING,
  IRONING: P.PROCESSING_IRONING,
  QUALITY_CHECK: P.PROCESSING_QC,
  PACKING: P.PROCESSING_PACKING,
  RECEIVING: P.ORDER_CREATE,
  DISPATCH: P.DELIVERY_MANAGE,
};
