import "server-only";

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export interface PortalCustomer {
  customerId: string;
  firmId: string;
  name: string;
  phone: string;
  firm: { name: string; phone: string | null; email: string | null };
}

/**
 * The signed-in customer, resolved ONLY from the session. A customer id in a
 * URL, form or header is never consulted; every portal query then filters by
 * both customerId and firmId taken from here.
 */
export async function getPortalCustomer(): Promise<PortalCustomer | null> {
  const session = await auth();
  const user = session?.user;
  if (!user || user.role !== "CUSTOMER" || !user.customerId || !user.firmId) return null;

  const customer = await prisma.customer.findFirst({
    where: { id: user.customerId, firmId: user.firmId, firm: { status: "ACTIVE" } },
    select: { id: true, firmId: true, name: true, phone: true, firm: { select: { name: true, phone: true, email: true } } },
  });
  if (!customer) return null;
  return { customerId: customer.id, firmId: customer.firmId, name: customer.name, phone: customer.phone, firm: customer.firm };
}

export async function requirePortalCustomer(): Promise<PortalCustomer> {
  const customer = await getPortalCustomer();
  if (!customer) redirect("/portal/login");
  return customer;
}
