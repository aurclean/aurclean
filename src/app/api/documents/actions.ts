"use server";

import { revalidatePath } from "next/cache";
import { requireFirmId, requirePermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/rbac";
import { sendDocumentToWhatsApp, type DocumentType } from "@/lib/services/whatsapp-document";
import { prisma } from "@/lib/prisma";

export async function sendDocumentWhatsAppAction(params: {
  documentType: DocumentType;
  documentId: string;
  customCaption?: string;
  pathName?: string;
}) {
  const session = await requirePermission([
    PERMISSIONS.ORDER_VIEW,
    PERMISSIONS.DELIVERY_VIEW,
    PERMISSIONS.BILLING_VIEW,
  ]);

  try {
    const result = await sendDocumentToWhatsApp({
      firmId: requireFirmId(session),
      documentType: params.documentType,
      documentId: params.documentId,
      sentByUserId: session.id,
      customCaption: params.customCaption,
    });

    if (params.pathName) {
      revalidatePath(params.pathName);
    }

    return {
      success: true,
      fileName: result.fileName,
      messageId: result.messageId,
      status: result.status,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Failed to dispatch document to WhatsApp",
    };
  }
}

import type { CompanyProfile } from "@/lib/pdf/pdf-builder";

export async function saveCompanyDocumentSettingsAction(data: Partial<CompanyProfile> & { name: string }) {
  const user = await requirePermission(PERMISSIONS.SETTINGS_MANAGE);
  const firmId = requireFirmId(user);

  const updates = [
    { key: "company_name", value: data.name ?? "", category: "company" },
    { key: "company_address", value: data.address ?? "", category: "company" },
    { key: "company_phone", value: data.phone ?? "", category: "company" },
    { key: "company_email", value: data.email ?? "", category: "company" },
    { key: "company_website", value: data.website ?? "", category: "company" },
    { key: "company_gstin", value: data.gstin ?? "", category: "company" },
    { key: "invoice_prefix", value: data.invoicePrefix ?? "INV", category: "documents" },
    { key: "challan_prefix", value: data.challanPrefix ?? "DC", category: "documents" },
    { key: "receipt_prefix", value: data.receiptPrefix ?? "REC", category: "documents" },
    { key: "document_footer_text", value: data.footerText ?? "", category: "documents" },
    { key: "document_terms", value: data.termsConditions ?? "", category: "documents" },
  ];

  await Promise.all(
    updates.map((item) =>
      prisma.setting.upsert({
        where: { firmId_key: { firmId, key: item.key } },
        create: { firmId, key: item.key, value: item.value, category: item.category },
        update: { value: item.value, category: item.category },
      }),
    ),
  );

  revalidatePath("/settings");
  revalidatePath("/settings/documents");

  return { success: true };
}
