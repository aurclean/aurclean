import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  Building2,
  ClipboardList,
  Cpu,
  DollarSign,
  Download,
  FileBarChart,
  FileSpreadsheet,
  FileText,
  Grid,
  Layers,
  LayoutDashboard,
  MessageSquare,
  Receipt,
  Scale,
  ScanLine,
  Settings,
  Shapes,
  Shirt,
  ShoppingBag,
  Tag,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { PERMISSIONS, type PermissionCode } from "@/lib/rbac";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** The user needs at least one of these to see the item. */
  permissions: PermissionCode[];
  /** Match sub-routes as active too. */
  exact?: boolean;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

import type { UserRole } from "@/generated/prisma/enums";

const item = (label: string, href: string, icon: LucideIcon, permissions: PermissionCode[], exact = false): NavItem => ({
  label,
  href,
  icon,
  permissions,
  exact,
});

/** Platform Super Admin: platform administration only, never a firm's day-to-day screens. */
const PLATFORM_NAV: NavSection[] = [
  {
    items: [
      item("Dashboard", "/platform", LayoutDashboard, [PERMISSIONS.PLATFORM_VIEW], true),
      item("Firms", "/firms", Building2, [PERMISSIONS.FIRM_VIEW]),
      item("Firm Managers", "/platform/managers", Users, [PERMISSIONS.FIRM_VIEW]),
      item("Platform Activity", "/platform/activity", Activity, [PERMISSIONS.PLATFORM_VIEW]),
      item("WhatsApp Overview", "/platform/whatsapp", MessageSquare, [PERMISSIONS.PLATFORM_VIEW]),
      item("Platform Settings", "/platform/settings", Settings, [PERMISSIONS.PLATFORM_VIEW]),
    ],
  },
];

/** Firm Manager: the spec's eleven entries; every other existing module stays reachable under "More". */
const FIRM_MANAGER_NAV: NavSection[] = [
  {
    items: [
      item("Dashboard", "/dashboard", LayoutDashboard, [PERMISSIONS.DASHBOARD_VIEW], true),
      item("Orders", "/orders", ClipboardList, [PERMISSIONS.ORDER_VIEW]),
      item("Customers", "/customers", Users, [PERMISSIONS.CUSTOMER_VIEW]),
      item("Field Managers", "/staff?role=FIELD_MANAGER", Truck, [PERMISSIONS.STAFF_VIEW]),
      item("QC", "/qc", Shirt, [PERMISSIONS.QC_VIEW]),
      item("Services", "/services", Tag, [PERMISSIONS.CATALOGUE_MANAGE]),
      item("Payments", "/billing", Receipt, [PERMISSIONS.BILLING_VIEW]),
      item("Documents", "/delivery-challans", FileText, [PERMISSIONS.BILLING_VIEW]),
      item("WhatsApp Settings", "/settings/whatsapp", MessageSquare, [PERMISSIONS.WHATSAPP_MANAGE]),
      item("Reports", "/reports", FileBarChart, [PERMISSIONS.REPORT_VIEW]),
      item("Firm Settings", "/settings", Settings, [PERMISSIONS.SETTINGS_MANAGE]),
    ],
  },
  {
    label: "MORE",
    items: [
      item("Garments", "/garments", Shirt, [PERMISSIONS.GARMENT_VIEW]),
      item("Processing", "/processing", Cpu, [PERMISSIONS.PROCESSING_VIEW]),
      item("Scan Station", "/scan", ScanLine, [PERMISSIONS.GARMENT_SCAN]),
      item("Delivery", "/delivery", Truck, [PERMISSIONS.DELIVERY_VIEW]),
      item("Finance", "/finance", DollarSign, [PERMISSIONS.FINANCE_VIEW], true),
      item("Expenses", "/expenses", Wallet, [PERMISSIONS.EXPENSE_VIEW]),
      item("Inventory", "/inventory", Boxes, [PERMISSIONS.INVENTORY_VIEW]),
      item("Purchases", "/purchases", ShoppingBag, [PERMISSIONS.PURCHASE_VIEW]),
      item("Activity Log", "/activity-log", Activity, [PERMISSIONS.AUDIT_VIEW]),
    ],
  },
];

const FIELD_MANAGER_NAV: NavSection[] = [
  {
    items: [
      item("Today", "/field", LayoutDashboard, [PERMISSIONS.FIELD_JOBS], true),
      item("Pickups", "/field/pickups", ArrowDownLeft, [PERMISSIONS.FIELD_JOBS]),
      item("Deliveries", "/field/deliveries", Truck, [PERMISSIONS.FIELD_JOBS]),
      item("Profile", "/profile", Users, [PERMISSIONS.FIELD_JOBS]),
    ],
  },
];

const QC_NAV: NavSection[] = [
  {
    items: [
      item("QC Queue", "/qc", ClipboardList, [PERMISSIONS.QC_VIEW], true),
      item("Passed", "/qc/passed", Shirt, [PERMISSIONS.QC_VIEW]),
      item("Failed / Rework", "/qc/failed", Layers, [PERMISSIONS.QC_VIEW]),
      item("Profile", "/profile", Users, [PERMISSIONS.QC_VIEW]),
    ],
  },
];

const ROLE_NAV: Record<UserRole, NavSection[]> = {
  PLATFORM_SUPER_ADMIN: FIRM_MANAGER_NAV, // while inside an entered firm
  FIRM_MANAGER: FIRM_MANAGER_NAV,
  FIELD_MANAGER: FIELD_MANAGER_NAV,
  QC: QC_NAV,
  CUSTOMER: [],
};

/**
 * Navigation for a role. `platformOnly` is true for a PLATFORM_SUPER_ADMIN who
 * has not explicitly entered a firm: they see only the platform screens.
 */
export function visibleSections(
  permissions: PermissionCode[],
  platformOnly = false,
  role: UserRole = "FIRM_MANAGER",
): NavSection[] {
  const has = (entry: NavItem) => entry.permissions.some((code) => permissions.includes(code));
  const sections = platformOnly ? PLATFORM_NAV : ROLE_NAV[role];
  return sections
    .map((section) => ({ ...section, items: section.items.filter(has) }))
    .filter((section) => section.items.length > 0);
}

/** The four bottom-tab entries for phones. */
export function mobileTabs(role: UserRole, platformOnly: boolean): NavItem[] {
  if (platformOnly) return PLATFORM_NAV[0].items.slice(0, 4);
  if (role === "FIELD_MANAGER") return FIELD_MANAGER_NAV[0].items;
  if (role === "QC") return QC_NAV[0].items;
  return FIRM_MANAGER_NAV[0].items.slice(0, 4);
}
