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

/**
 * Real-world Complete Laundry ERP Navigation Structure.
 * Structured into Operations, Finance, Inventory, and Management.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "OPERATIONS",
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        permissions: [PERMISSIONS.DASHBOARD_VIEW],
        exact: true,
      },
      {
        label: "Orders",
        href: "/orders",
        icon: ClipboardList,
        permissions: [PERMISSIONS.ORDER_VIEW],
      },
      {
        label: "Garments",
        href: "/garments",
        icon: Shirt,
        permissions: [PERMISSIONS.GARMENT_VIEW],
      },
      {
        label: "Categories",
        href: "/categories",
        icon: Shapes,
        permissions: [PERMISSIONS.GARMENT_VIEW, PERMISSIONS.CATALOGUE_MANAGE],
      },
      {
        label: "Customers",
        href: "/customers",
        icon: Users,
        permissions: [PERMISSIONS.CUSTOMER_VIEW],
      },
      {
        label: "Services & Pricing",
        href: "/services",
        icon: Tag,
        permissions: [PERMISSIONS.CATALOGUE_MANAGE, PERMISSIONS.ORDER_VIEW],
      },
      {
        label: "Processing",
        href: "/processing",
        icon: Cpu,
        permissions: [PERMISSIONS.PROCESSING_VIEW],
      },
      {
        label: "Scan Station",
        href: "/scan",
        icon: ScanLine,
        permissions: [PERMISSIONS.GARMENT_SCAN],
      },
      {
        label: "Batch Scan",
        href: "/scan?mode=batch",
        icon: Layers,
        permissions: [PERMISSIONS.GARMENT_SCAN],
      },
      {
        label: "Delivery",
        href: "/delivery",
        icon: Truck,
        permissions: [PERMISSIONS.DELIVERY_VIEW],
      },
      {
        label: "Delivery Challans",
        href: "/delivery-challans",
        icon: FileText,
        permissions: [PERMISSIONS.DELIVERY_VIEW],
      },
    ],
  },
  {
    label: "FINANCE",
    items: [
      {
        label: "Financial Overview",
        href: "/finance",
        icon: DollarSign,
        permissions: [PERMISSIONS.FINANCE_VIEW],
        exact: true,
      },
      {
        label: "Business Ledger",
        href: "/finance/ledger",
        icon: FileSpreadsheet,
        permissions: [PERMISSIONS.FINANCE_VIEW],
      },
      {
        label: "Incoming Money",
        href: "/finance/incoming",
        icon: ArrowDownLeft,
        permissions: [PERMISSIONS.FINANCE_VIEW],
      },
      {
        label: "Outgoing Money",
        href: "/finance/outgoing",
        icon: ArrowUpRight,
        permissions: [PERMISSIONS.FINANCE_VIEW],
      },
      {
        label: "Cash in Hand",
        href: "/finance/cash",
        icon: Wallet,
        permissions: [PERMISSIONS.FINANCE_VIEW],
      },
      {
        label: "Bank Accounts",
        href: "/finance/bank-accounts",
        icon: Building2,
        permissions: [PERMISSIONS.FINANCE_VIEW],
      },
      {
        label: "Customer Receivables",
        href: "/finance/receivables",
        icon: ArrowDownLeft,
        permissions: [PERMISSIONS.FINANCE_VIEW],
      },
      {
        label: "Supplier Payables",
        href: "/finance/payables",
        icon: ArrowUpRight,
        permissions: [PERMISSIONS.FINANCE_VIEW],
      },
      {
        label: "Payments & Invoices",
        href: "/billing",
        icon: Receipt,
        permissions: [PERMISSIONS.BILLING_VIEW],
      },
      {
        label: "Expenses",
        href: "/expenses",
        icon: Wallet,
        permissions: [PERMISSIONS.EXPENSE_VIEW],
      },
      {
        label: "Sales Register",
        href: "/finance/sales",
        icon: ShoppingBag,
        permissions: [PERMISSIONS.FINANCE_VIEW],
      },
      {
        label: "Financial Reports & P&L",
        href: "/finance/reports",
        icon: FileBarChart,
        permissions: [PERMISSIONS.REPORT_VIEW],
      },
      {
        label: "Reconciliation",
        href: "/finance/reconciliation",
        icon: Scale,
        permissions: [PERMISSIONS.FINANCE_VIEW],
      },
    ],
  },
  {
    label: "INVENTORY",
    items: [
      {
        label: "Consumables Inventory",
        href: "/inventory",
        icon: Boxes,
        permissions: [PERMISSIONS.INVENTORY_VIEW],
      },
      {
        label: "Suppliers",
        href: "/purchases/suppliers",
        icon: Users,
        permissions: [PERMISSIONS.PURCHASE_VIEW],
      },
      {
        label: "Purchase Orders",
        href: "/purchases",
        icon: ClipboardList,
        permissions: [PERMISSIONS.PURCHASE_VIEW],
      },
    ],
  },
  {
    label: "MANAGEMENT",
    items: [
      {
        label: "Staff Directory",
        href: "/staff",
        icon: Users,
        permissions: [PERMISSIONS.STAFF_VIEW],
      },
      {
        label: "Operational Reports",
        href: "/reports",
        icon: FileBarChart,
        permissions: [PERMISSIONS.REPORT_VIEW],
      },
      {
        label: "System Activity Log",
        href: "/activity-log",
        icon: Activity,
        permissions: [PERMISSIONS.AUDIT_VIEW],
      },
      {
        label: "Import / Export",
        href: "/management/import-export",
        icon: Download,
        permissions: [PERMISSIONS.DATA_IMPORT_EXPORT],
      },
      {
        label: "WhatsApp Gateway",
        href: "/settings/whatsapp",
        icon: MessageSquare,
        permissions: [PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.NOTIFICATION_VIEW],
      },
      {
        label: "Settings",
        href: "/settings",
        icon: Settings,
        permissions: [
          PERMISSIONS.SETTINGS_MANAGE,
          PERMISSIONS.BRANCH_VIEW,
          PERMISSIONS.CATALOGUE_MANAGE,
          PERMISSIONS.NOTIFICATION_VIEW,
        ],
      },
    ],
  },
];

/** Cross-firm platform admin's own section — never tied to any one firm's data. */
const PLATFORM_SECTION: NavSection = {
  label: "PLATFORM",
  items: [
    {
      label: "Firms",
      href: "/firms",
      icon: Building2,
      permissions: [PERMISSIONS.FIRM_VIEW],
    },
  ],
};

/**
 * `platformOnly` is true for a PLATFORM_ADMIN who hasn't "entered" a firm
 * yet (session.ts's activeFirmId is null in that state). Every operational
 * nav item leads to a page that requires an active firm and would 403, so
 * only the Firms section is shown until one is selected.
 */
export function visibleSections(
  permissions: PermissionCode[],
  platformOnly = false,
): NavSection[] {
  const has = (item: NavItem) =>
    item.permissions.some((code) => permissions.includes(code));

  const sections = platformOnly ? [PLATFORM_SECTION] : [...NAV_SECTIONS, PLATFORM_SECTION];

  return sections
    .map((section) => ({ ...section, items: section.items.filter(has) }))
    .filter((section) => section.items.length > 0);
}
