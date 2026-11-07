import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { OrderForm } from "@/app/(app)/orders/new/order-form";
import { prisma } from "@/lib/prisma";
import { num } from "@/lib/money";
import { PERMISSIONS } from "@/lib/rbac";
import { assertBranchAccess, hasPermission, requireFirmId, requirePermission } from "@/lib/session";
import { isGlobalRole } from "@/lib/rbac";

export const metadata = { title: "New order" };

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  const user = await requirePermission(PERMISSIONS.ORDER_CREATE);
  const firmId = requireFirmId(user);
  const { customer: customerId } = await searchParams;

  const [services, garmentTypes, branches, b2bAccounts, gstSetting] = await Promise.all([
    prisma.service.findMany({
      where: { firmId, isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        pricingMode: true,
        basePrice: true,
        turnaroundHours: true,
      },
    }),
    prisma.garmentType.findMany({
      where: { firmId, isActive: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: { id: true, name: true, category: true },
    }),
    prisma.branch.findMany({
      where: {
        firmId,
        isActive: true,
        ...(isGlobalRole(user.role) ? {} : { id: user.branchId ?? "__none__" }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    prisma.b2BAccount.findMany({
      where: { firmId, isActive: true },
      orderBy: { businessName: "asc" },
      select: { id: true, businessName: true, code: true },
    }),
    prisma.setting.findUnique({ where: { firmId_key: { firmId, key: "gst_rate" } } }),
  ]);

  // Arriving from a customer profile pre-fills the booking with their details.
  const initialCustomer = customerId
    ? await prisma.customer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          branchId: true,
          name: true,
          phone: true,
          email: true,
          addressLine: true,
          city: true,
          pincode: true,
          landmark: true,
          orderCount: true,
          outstandingAmount: true,
        },
      })
    : null;

  if (initialCustomer) assertBranchAccess(user, initialCustomer.branchId);

  if (services.length === 0 || garmentTypes.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader title="New order" />
        <EmptyState
          title="Catalogue is empty"
          description="Add at least one service and one garment type before booking orders."
          action={
            <Button asChild size="sm">
              <Link href="/settings/catalogue">Open catalogue settings</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="New order"
        description="Book garments in, price them, and generate a tracked tag for every piece."
        actions={
          <Button asChild variant="outline">
            <Link href="/orders">
              <ArrowLeft /> All orders
            </Link>
          </Button>
        }
      />

      <OrderForm
        initialCustomer={
          initialCustomer
            ? {
                ...initialCustomer,
                outstandingAmount: num(initialCustomer.outstandingAmount),
              }
            : null
        }
        services={services.map((service) => ({
          ...service,
          basePrice: num(service.basePrice),
        }))}
        garmentTypes={garmentTypes}
        branches={branches}
        b2bAccounts={b2bAccounts}
        defaultBranchId={initialCustomer?.branchId ?? user.branchId ?? branches[0]?.id ?? null}
        canDiscount={hasPermission(user, PERMISSIONS.ORDER_APPLY_DISCOUNT)}
        defaultGstRate={Number(gstSetting?.value ?? 18)}
      />
    </div>
  );
}
