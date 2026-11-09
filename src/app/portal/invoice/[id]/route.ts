import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getPortalCustomer } from "@/lib/portal-session";
import { generateInvoicePDF } from "@/lib/pdf/pdf-templates";

export const dynamic = "force-dynamic";

/** A customer may download only their own invoices (same PDF the firm generates). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getPortalCustomer();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const invoice = await prisma.invoice.findFirst({ where: { id, customerId: me.customerId, firmId: me.firmId }, select: { id: true } });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { buffer, fileName } = await generateInvoicePDF(invoice.id, { firmId: me.firmId });
  return new NextResponse(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${fileName}"`, "Cache-Control": "private, no-store" },
  });
}
