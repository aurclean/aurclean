import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { PERMISSIONS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { getFieldJobs } from "@/lib/services/field-jobs";
import { JobCard } from "@/app/(app)/field/job-card";
import { toJobViews } from "@/app/(app)/field/views";

export const metadata = { title: "Deliveries" };
export const dynamic = "force-dynamic";

export default async function FieldDeliveriesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await requirePermission(PERMISSIONS.FIELD_JOBS);
  const history = (await searchParams).view === "history";
  const { pickups, deliveries } = await getFieldJobs(user, { history });
  const jobs = toJobViews([], deliveries);

  return (
    <div className="space-y-4">
      <PageHeader title="Deliveries" description={history ? "Your completed and closed jobs" : "Assigned to you"} />
      <div className="flex gap-2 text-sm">
        <Link href="?" className={history ? "text-muted-foreground" : "font-semibold underline"}>Active</Link>
        <Link href="?view=history" className={history ? "font-semibold underline" : "text-muted-foreground"}>History</Link>
      </div>
      {jobs.length === 0 ? <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">No jobs here.</p> : null}
      <div className="space-y-3">
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} readOnly={history} />
        ))}
      </div>
    </div>
  );
}
