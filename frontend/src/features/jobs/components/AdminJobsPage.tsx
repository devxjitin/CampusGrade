"use client";

// Super Admin → Background jobs (Sprint 2, S2-12): see what the worker is doing, inspect
// failures, and retry jobs that ran out of attempts.
import { Fragment, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RotateCcw } from "lucide-react";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { formatDateTime, formatRelativeTime } from "@/lib/datetime";
import { getErrorMessage } from "@/lib/errors";
import { useJobs, useRetryJob } from "../queries";
import type { Job, JobStatus } from "../types";

const PAGE_SIZE = 25;

type Filter = JobStatus | "all";

// Reuses the shared badge tones: a failed attempt that will be retried reads as "pending".
const badgeFor = (status: JobStatus): { status: string; label: string } => {
  switch (status) {
    case "queued":
      return { status: "scheduled", label: "Queued" };
    case "running":
      return { status: "in_progress", label: "Running" };
    case "succeeded":
      return { status: "completed", label: "Succeeded" };
    case "failed":
      return { status: "pending", label: "Retrying" };
    case "dead":
      return { status: "failed", label: "Dead" };
  }
};

const typeLabel = (type: string) => type.replaceAll(".", " · ").replaceAll("_", " ");

const whenLabel = (job: Job) => {
  if (job.status === "succeeded" || job.status === "dead") return job.finished_at ? `Finished ${formatRelativeTime(job.finished_at)}` : "—";
  if (job.status === "running") return job.locked_at ? `Started ${formatRelativeTime(job.locked_at)}` : "Running";
  const runAt = job.run_after ? new Date(`${job.run_after}Z`) : null;
  if (!runAt || runAt.getTime() <= Date.now()) return "Due now";
  return `Runs ${formatDateTime(job.run_after, { hour: "2-digit", minute: "2-digit" })}`;
};

export default function AdminJobsPage() {
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("dead");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const { data, isPending, isError, refetch } = useJobs({
    ...(filter === "all" ? {} : { status: filter }),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  const retry = useRetryJob();

  const counts = data?.counts ?? {};
  const total = Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0);
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  const retryJob = (job: Job) =>
    retry.mutate(job.id, {
      onSuccess: () => toast.success(`Job #${job.id} queued for retry`),
      onError: (error) => toast.error(getErrorMessage(error, "The job could not be retried.")),
    });

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Background jobs"
        description="Repository analysis and other work run on the worker. Jobs that keep failing end up dead and wait here for a retry."
      />

      <div className="mb-4">
        <Tabs
          label="Job status"
          value={filter}
          onChange={(value) => {
            setFilter(value as Filter);
            setPage(0);
            setExpanded(null);
          }}
          tabs={[
            { value: "dead", label: "Dead", count: counts.dead ?? 0 },
            { value: "failed", label: "Retrying", count: counts.failed ?? 0 },
            { value: "running", label: "Running", count: counts.running ?? 0 },
            { value: "queued", label: "Queued", count: counts.queued ?? 0 },
            { value: "succeeded", label: "Succeeded", count: counts.succeeded ?? 0 },
            { value: "all", label: "All", count: total },
          ]}
        />
      </div>

      <section className="card overflow-hidden">
        {isPending ? (
          <LoadingState label="Loading jobs…" />
        ) : isError ? (
          <ErrorState title="Jobs could not be loaded" onRetry={() => refetch()} />
        ) : data.jobs.length === 0 ? (
          <EmptyState
            title={filter === "dead" ? "No dead jobs" : "No jobs here"}
            description={filter === "dead" ? "Everything the worker has run is either done or still retrying." : "Nothing matches this filter yet."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="border-b border-slate-100 text-xs font-bold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-5 py-3">Job</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Attempts</th>
                  <th className="px-5 py-3">When</th>
                  <th className="px-5 py-3 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.jobs.map((job) => {
                  const badge = badgeFor(job.status);
                  const open = expanded === job.id;
                  return (
                    <Fragment key={job.id}>
                      <tr className="align-top">
                        <td className="px-5 py-4">
                          <button
                            type="button"
                            className="flex items-center gap-2 text-left font-semibold text-slate-900"
                            aria-expanded={open}
                            onClick={() => setExpanded(open ? null : job.id)}
                          >
                            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            <span>
                              <span className="block capitalize">{typeLabel(job.type)}</span>
                              <span className="block text-xs font-normal text-slate-500">#{job.id}</span>
                            </span>
                          </button>
                          {!open && job.last_error && <p className="mt-2 [overflow-wrap:anywhere] max-w-md pl-6 text-xs text-rose-600">{job.last_error}</p>}
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge status={badge.status} label={badge.label} />
                        </td>
                        <td className="px-5 py-4 text-slate-700">
                          {job.attempts} of {job.max_attempts}
                        </td>
                        <td className="px-5 py-4 text-slate-600" title={formatDateTime(job.finished_at || job.run_after)}>
                          {whenLabel(job)}
                        </td>
                        <td className="px-5 py-4 text-right">
                          {job.status === "dead" && (
                            <button className="btn btn-outline text-sm" disabled={retry.isPending} onClick={() => retryJob(job)}>
                              <RotateCcw className="h-4 w-4" />
                              Retry
                            </button>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-slate-50">
                          <td colSpan={5} className="px-5 py-4">
                            <dl className="grid gap-4 text-sm sm:grid-cols-3">
                              <div>
                                <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Created</dt>
                                <dd className="mt-1 text-slate-800">{formatDateTime(job.created_at)}</dd>
                              </div>
                              <div>
                                <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Worker</dt>
                                <dd className="mt-1 break-all text-slate-800">{job.locked_by || "—"}</dd>
                              </div>
                              <div>
                                <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">Next run</dt>
                                <dd className="mt-1 text-slate-800">{job.status === "failed" || job.status === "queued" ? formatDateTime(job.run_after) : "—"}</dd>
                              </div>
                            </dl>
                            <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-400">Payload</h3>
                            <pre className="mt-1 max-h-40 overflow-auto rounded-lg border border-slate-200 bg-white p-3 text-xs">{JSON.stringify(job.payload, null, 2)}</pre>
                            {job.last_error && (
                              <>
                                <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-400">Last error</h3>
                                <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                                  {job.last_error}
                                </pre>
                              </>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-100 p-4">
          <button className="btn btn-outline text-sm" disabled={page <= 0} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" />
            Previous
          </button>
          <span className="text-sm text-slate-500">
            Page {page + 1} of {pageCount}
          </span>
          <button className="btn btn-outline text-sm" disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </section>
    </>
  );
}
