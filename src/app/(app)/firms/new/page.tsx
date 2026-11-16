import { PageHeader } from "@/components/shared/page-header";
import { PERMISSIONS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { CreateFirmDialog } from "@/app/(app)/firms/firm-dialogs";

export const metadata = { title: "Create firm" };

export default async function NewFirmPage() {
  await requirePermission(PERMISSIONS.FIRM_MANAGE);
  return (
    <div className="space-y-5">
      <PageHeader title="Create firm" description="Registers a firm, its first branch, settings, WhatsApp record and Firm Manager. The manager's access code is shown once." />
      <CreateFirmDialog defaultOpen />
    </div>
  );
}
