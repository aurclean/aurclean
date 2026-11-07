import { PageHeader } from "@/components/shared/page-header";
import { PERMISSIONS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { ImportExportView } from "./import-export-view";

export const metadata = { title: "Import / Export" };

export default async function ImportExportPage() {
  await requirePermission(PERMISSIONS.DATA_IMPORT_EXPORT);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Data Import & Export Center"
        description="Safely export ledger data, sales, purchases and customers as CSV, or import customer directories & opening balances with validation previews."
      />
      <ImportExportView />
    </div>
  );
}
