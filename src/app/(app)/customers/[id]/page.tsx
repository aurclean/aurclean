import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BadgeIndianRupee,
  ClipboardList,
  Mail,
  MapPin,
  Phone,
  Plus,
  Repeat,
  Wallet,
} from "lucide-react";

import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { PERMISSIONS } from "@/lib/rbac";
import { assertBranchAccess, hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { getCustomerProfile } from "@/lib/services/customers";
import { ORDER_STATUS_LABELS } from "@/lib/workflow";
import type { OrderStatus } from "@/generated/prisma/enums";
import { getWhatsAppHistory } from "@/lib/services/whatsapp";
import { WhatsAppButton } from "@/components/whatsapp/whatsapp-button";
import { DocumentActionBar } from "@/components/documents/document-action-bar";
import { getCompanyProfile } from "@/lib/pdf/pdf-builder";
import { DeleteCustomerButton, EditCustomerDialog } from "../customer-dialogs";

export const metadata = { title: "Customer" };

export default async function CustomerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePermission(PERMISSIONS.CUSTOMER_VIEW);
  const firmId = requireFirmId(user);

  const customer = await getCustomerProfile(id, firmId).catch(() => null);
  if (!customer) notFound();
  assertBranchAccess(user, customer.branchId);

  const canBook = hasPermission(user, PERMISSIONS.ORDER_CREATE);
  const waHistory = await getWhatsAppHistory(firmId, { customerId: id });
  const company = await getCompanyProfile(firmId);

  const columns: Column<(typeof customer.orders)[number]>[] = [
    {
      key: "order",
      header: "Order",
      cell: (row) => (
        <Link
          href={`/orders/${row.id}`}
          className="font-mono text-sm font-medium text-primary hover:underline"
        >
          {row.orderNumber}
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => (
        <StatusBadge
          status={row.status}
          label={ORDER_STATUS_LABELS[row.status as OrderStatus] ?? row.status}
        />
      ),
    },
    {
      key: "placed",
      header: "Booked",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.placedAt)}</span>
      ),
    },
    {
      key: "due",
      header: "Due",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(row.expectedDeliveryAt)}
        </span>
      ),
    },
    {
      key: "pieces",
      header: "Pieces",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => <span className="text-sm numeric">{row.totalPieces}</span>,
    },
    {
      key: "total",
      header: "Total",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <span className="text-sm numeric">{formatCurrency(row.totalAmount)}</span>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <span
          className={`text-sm numeric ${row.outstandingAmount > 0 ? "font-medium text-destructive" : "text-muted-foreground"}`}
        >
          {formatCurrency(row.outstandingAmount)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={customer.name}
        description={`${customer.code} · ${customer.branchName} · on file since ${formatDate(customer.createdAt)}`}
        actions={
          <>
            <Button asChild variant="outline" size="icon" aria-label="Back to customers">
              <Link href="/customers">
                <ArrowLeft />
              </Link>
            </Button>
            <DocumentActionBar
              documentType="STATEMENT"
              documentId={customer.id}
              documentNumber={`STATEMENT-${customer.name.replace(/\s+/g, "")}`}
              customerPhone={customer.phone}
              customerName={customer.name}
              pdfUrl={`/api/documents/pdf?type=STATEMENT&id=${customer.id}`}
            />
            {hasPermission(user, PERMISSIONS.CUSTOMER_MANAGE) ? (
              <EditCustomerDialog
                customer={{
                  id: customer.id,
                  name: customer.name,
                  phone: customer.phone,
                  email: customer.email ?? "",
                  addressLine: customer.addressLine ?? "",
                  city: customer.city ?? "",
                  pincode: customer.pincode ?? "",
                  landmark: customer.landmark ?? "",
                  notes: customer.notes ?? "",
                  isActive: customer.isActive,
                }}
              />
            ) : null}
            {hasPermission(user, PERMISSIONS.CUSTOMER_MANAGE) ? (
              <DeleteCustomerButton
                customerId={customer.id}
                name={customer.name}
                orderCount={customer.orderCount}
              />
            ) : null}
            {canBook ? (
              <Button asChild>
                <Link href={`/orders/new?customer=${customer.id}`}>
                  <Plus /> New order
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        {customer.isRepeat ? (
          <Badge tone="success" className="gap-1">
            <Repeat className="size-3" /> Repeat customer
          </Badge>
        ) : (
          <Badge tone="neutral">First-time customer</Badge>
        )}
        {!customer.isActive ? <Badge tone="danger">Inactive</Badge> : null}
        {customer.activeOrders > 0 ? (
          <Badge tone="progress">{customer.activeOrders} in progress</Badge>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Orders" value={customer.orderCount} icon={ClipboardList} />
        <StatCard
          label="Lifetime spend"
          value={formatCurrency(customer.totalSpent)}
          icon={BadgeIndianRupee}
        />
        <StatCard
          label="Average order"
          value={formatCurrency(customer.averageOrderValue)}
          icon={BadgeIndianRupee}
        />
        <StatCard
          label="Balance owed"
          value={formatCurrency(customer.outstandingAmount)}
          icon={Wallet}
          tone={customer.outstandingAmount > 0 ? "warning" : "default"}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="flex items-center gap-2">
                <Phone className="size-4 text-muted-foreground" />
                <span className="font-mono">{customer.phone}</span>
              </p>
              {customer.email ? (
                <p className="flex items-center gap-2">
                  <Mail className="size-4 text-muted-foreground" />
                  <span className="break-all">{customer.email}</span>
                </p>
              ) : null}
              {customer.addressLine ? (
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>
                    {customer.addressLine}
                    {customer.landmark ? `, near ${customer.landmark}` : ""}
                    {customer.city ? `, ${customer.city}` : ""}
                    {customer.pincode ? ` ${customer.pincode}` : ""}
                  </span>
                </p>
              ) : null}
              {customer.lastOrderAt ? (
                <p className="text-muted-foreground">
                  Last order {formatDateTime(customer.lastOrderAt)}
                </p>
              ) : null}
              {customer.notes ? (
                <p className="rounded-lg bg-muted px-3 py-2">{customer.notes}</p>
              ) : null}
            </CardContent>
          </Card>

          {customer.topServices.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Usual services</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {customer.topServices.map((service) => (
                  <div
                    key={service.name}
                    className="flex items-center justify-between text-sm"
                  >
                    <span>{service.name}</span>
                    <span className="numeric text-muted-foreground">
                      {service.pieces} pieces
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Order history</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              rows={customer.orders}
              getRowKey={(row) => row.id}
              empty={
                <EmptyState
                  icon={ClipboardList}
                  title="No orders yet"
                  description="Book the first order for this customer to start their history."
                />
              }
            />
          </CardContent>
        </Card>

        {/* Delivery Challans */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Delivery Challans</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={[
                {
                  key: "challanNumber",
                  header: "Challan No",
                  cell: (row: any) => (
                    <Link
                      href={`/delivery-challans/${row.id}`}
                      className="font-mono text-sm font-bold text-emerald-700 hover:underline"
                    >
                      {row.challanNumber}
                    </Link>
                  ),
                },
                {
                  key: "orderNumber",
                  header: "Order No",
                  cell: (row: any) => (
                    <Link
                      href={`/orders/${row.orderId}`}
                      className="font-mono text-sm text-slate-800 hover:underline"
                    >
                      {row.order?.orderNumber}
                    </Link>
                  ),
                },
                {
                  key: "challanDate",
                  header: "Date",
                  cell: (row: any) => (
                    <span className="text-sm text-muted-foreground">{formatDate(row.challanDate)}</span>
                  ),
                },
                {
                  key: "grandTotal",
                  header: "Amount",
                  className: "text-right",
                  headerClassName: "text-right",
                  cell: (row: any) => (
                    <span className="text-sm font-bold numeric">{formatCurrency(row.grandTotal)}</span>
                  ),
                },
                {
                  key: "status",
                  header: "Status",
                  cell: (row: any) => (
                    <StatusBadge
                      status={row.status}
                      label={row.status.replace(/_/g, " ")}
                    />
                  ),
                },
              ]}
              rows={(customer as any).deliveryChallans || []}
              getRowKey={(row: any) => row.id}
              empty={
                <EmptyState
                  icon={ClipboardList}
                  title="No delivery challans generated"
                  description="Delivery challans generated for this customer will be listed here."
                />
              }
            />
          </CardContent>
        </Card>
      </div>

      {/* WhatsApp Communication History */}
      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            WhatsApp Communication History
          </CardTitle>
          <WhatsAppButton
            customerName={customer.name}
            phone={customer.phone}
            customerId={customer.id}
            label="Send WhatsApp"
            initialType="CUSTOM"
            businessName={company.name}
          />
        </CardHeader>
        <CardContent>
          <DataTable
            columns={[
              {
                key: "sentAt",
                header: "Date & Time",
                cell: (row) => (
                  <span className="text-xs text-muted-foreground">{formatDateTime(row.sentAt)}</span>
                ),
              },
              {
                key: "messageType",
                header: "Message Type",
                cell: (row) => (
                  <Badge tone="neutral" className="text-xs font-mono">
                    {row.messageType}
                  </Badge>
                ),
              },
              {
                key: "document",
                header: "Document",
                cell: (row) => (
                  <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">
                    {row.documentName || "—"}
                  </span>
                ),
              },
              {
                key: "status",
                header: "Status",
                cell: (row) => (
                  <Badge
                    tone={
                      row.status === "DELIVERED" || row.status === "READ"
                        ? "success"
                        : row.status === "SENT"
                        ? "info"
                        : "danger"
                    }
                    className="text-[10px]"
                  >
                    ✓ {row.status}
                  </Badge>
                ),
              },
              {
                key: "sentBy",
                header: "Sent By",
                cell: (row) => (
                  <span className="text-xs text-muted-foreground">
                    {row.sentByUser?.name || "System"}
                  </span>
                ),
              },
            ]}
            rows={waHistory}
            getRowKey={(row) => row.id}
            empty={
              <EmptyState
                icon={ClipboardList}
                title="No WhatsApp messages sent yet"
                description="Use the WhatsApp button above to send invoices, receipts, and order updates."
              />
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
