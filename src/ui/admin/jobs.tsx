"use client";

import { useEffect, useState } from "react";
import { fetchJobs, type AdminResult } from "@/client/admin/api";
import type { Jobs } from "@/domain/admin/system";
import { label } from "@/domain/admin/stops";
import { Chip, ErrorNote, Muted, PageTitle, Panel, when } from "./parts";

// A20 Jobs (N7, C12), admins only: the background job queue (ops.job) by status, the latest 100
// rows (kind, status, attempts, error code; never the payload), and the last retention runs.
// Read-only: jobs retry by themselves with backoff and end as done or dead.

export function JobsScreen() {
  const [state, setState] = useState<AdminResult<Jobs> | null>(null);
  useEffect(() => {
    let live = true;
    void fetchJobs().then((r) => live && setState(r));
    return () => {
      live = false;
    };
  }, []);

  if (state === null) return <Muted>Loading…</Muted>;
  if (!state.ok) return <ErrorNote>{state.message}</ErrorNote>;
  const { counts, jobs, retention } = state.data;

  return (
    <div data-testid="admin-jobs">
      <PageTitle lead="Background work: moderation, photo processing, clean-up. Jobs retry on their own with a growing delay; a dead job has used all its attempts.">Jobs</PageTitle>
      <div className="grid gap-6">
        <Panel title="Queue" testId="jobs-counts">
          {counts.length === 0 ? (
            <Muted>The queue is empty.</Muted>
          ) : (
            <dl className="flex flex-wrap gap-6">
              {counts.map((c) => (
                <div key={c.status}>
                  <dt className="text-sm text-ink-2 dark:text-slate-300">{label(c.status)}</dt>
                  <dd className="text-2xl font-semibold tabular-nums" data-testid={`jobs-count-${c.status}`}>
                    {c.count}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Panel>

        <Panel title="Retention purge (driver evidence)" testId="jobs-retention">
          {retention.length === 0 ? (
            <Muted>No retention run is recorded. Schedule /api/cron/retention (see the setup notes).</Muted>
          ) : (
            <ul className="grid gap-1 text-sm">
              {retention.map((r, i) => (
                <li key={i}>
                  {when(r.at)}: {r.dryRun ? "dry run, would purge" : "purged"} {r.complaints} reports, {r.uploads} unused uploads, {r.objects} files
                  {r.failed ? (
                    <span className="ml-2">
                      <Chip tone="warn">{r.failed} could not be removed; retried next run</Chip>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Latest jobs" testId="jobs-list">
          {jobs.length === 0 ? (
            <Muted>No job has run yet.</Muted>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="jobs-table">
                <caption className="sr-only">The 100 most recent jobs, newest first</caption>
                <thead>
                  <tr>
                    {["Created", "Kind", "Status", "Attempts", "Next run", "Finished", "Last error"].map((h) => (
                      <th key={h} scope="col" className="py-1 pr-3 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className="border-t border-fill dark:border-navy-raised">
                      <td className="py-1 pr-3">{when(j.createdAt)}</td>
                      <td className="py-1 pr-3">{label(j.kind)}</td>
                      <td className="py-1 pr-3">{j.status === "dead" ? <Chip tone="warn">dead</Chip> : label(j.status)}</td>
                      <td className="py-1 pr-3 tabular-nums">
                        {j.attempts} / {j.maxAttempts}
                      </td>
                      <td className="py-1 pr-3">{j.status === "done" || j.status === "dead" ? "–" : when(j.runAfter)}</td>
                      <td className="py-1 pr-3">{when(j.finishedAt)}</td>
                      <td className="py-1 pr-3">{j.lastErrorCode ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
