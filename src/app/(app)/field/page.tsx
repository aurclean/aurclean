import { PageHeader } from "@/components/shared/page-header";
import { PERMISSIONS } from "@/lib/rbac";
import { requirePermission } from "@/lib/session";
import { getFieldJobs } from "@/lib/services/field-jobs";
import { JobCard } from "@/app/(app)/field/job-card";
import { toJobViews } from "@/app/(app)/field/views";

export const metadata = { title: "Today" };
export const dynamic = "force-dynamic";

export default async function FieldTodayPage() {
  const user = await requirePermission(PERMISSIONS.FIELD_JOBS);
  const { pickups, deliveries } = await getFieldJobs(user, { todayOnly: true });
  const jobs = toJobViews(pickups, deliveries);

  return (
    <div className="space-y-4">
      <PageHeader title="Today" description={`${jobs.length} job${jobs.length === 1 ? "" : "s"} assigned to you`} />
      {jobs.length === 0 ? <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Nothing assigned for today.</p> : null}
      <div className="space-y-3">
        {jobs.map((job) => (
          <JobCard key={`${job.kind}-${job.id}`} job={job} />
        ))}
      </div>
    </div>
  );
}
