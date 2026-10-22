"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchDashboard, type AdminResult } from "@/client/admin/api";
import type { AdminDashboard as Dashboard } from "@/domain/admin/schemas";
import { ErrorNote, Muted, PageTitle, Panel, when } from "./parts";

// A1 Dashboard (N5a, C1): read-only counts that exist in the database today.
export function AdminDashboard() {
  const [state, setState] = useState<AdminResult<Dashboard> | null>(null);
  useEffect(() => {
    let live = true;
    void fetchDashboard().then((r) => live && setState(r));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div data-testid="admin-dashboard">
      <PageTitle lead="What is published, what is waiting, and the last import. Counts only; nothing here changes data.">Dashboard</PageTitle>
      {state === null ? (
        <Muted>Loading…</Muted>
      ) : !state.ok ? (
        <ErrorNote testId="admin-dashboard-error">{state.message}</ErrorNote>
      ) : (
        <Cards d={state.data} />
      )}
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: string | number; testId: string }) {
  return (
    <div>
      <dt className="text-sm text-ink-2 dark:text-slate-300">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function Cards({ d }: { d: Dashboard }) {
  const draft = d.latestDraft;
  const draftState = !draft
    ? "No open draft"
    : draft.validationOk === null
      ? "Not validated yet"
      : !draft.validationCurrent
        ? "Changed since the last validation"
        : draft.validationOk
          ? `Validation passed ${when(draft.validatedAt)}`
          : "Validation found errors";
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
      <Panel title="Published revision" testId="card-published">
        {d.published ? (
          <div className="grid gap-3">
            <dl>
              <Stat label="Label" value={d.published.label} testId="published-label" />
            </dl>
            <Muted>
              {d.published.kind === "provisional" ? "Provisional (unverified data)" : "Verified"} · #{d.published.seq} · published {when(d.published.publishedAt)}
            </Muted>
          </div>
        ) : (
          <Muted>Nothing is published.</Muted>
        )}
      </Panel>
      <Panel title="Draft" testId="card-draft">
        <div className="grid gap-3">
          <dl>
            <Stat label="Open drafts" value={d.drafts} testId="draft-count" />
          </dl>
          <Muted>
            {draft ? `${draft.label}: ` : ""}
            {draftState}
          </Muted>
        </div>
        <p className="mt-3 text-sm">
          <Link href="/admin/revisions" prefetch={false} className="font-medium text-teal-ink underline dark:text-teal-bright">
            Revisions and publication
          </Link>
        </p>
      </Panel>
      <Panel title="Stops in the published revision" testId="card-stops">
        <dl className="grid grid-cols-2 gap-3">
          <Stat label="Candidates to review" value={d.stopCandidates} testId="stop-candidates" />
          <Stat label="All stops" value={d.stopsTotal} testId="stops-total" />
        </dl>
      </Panel>
      <Panel title="Corrections" testId="card-corrections">
        <dl>
          <Stat label="Open (submitted, under review, needs evidence)" value={d.openCorrections} testId="open-corrections" />
        </dl>
      </Panel>
      <Panel title="Last import" testId="card-import">
        {d.lastImport ? (
          <div className="grid gap-2">
            <dl>
              <Stat label="Snapshot" value={d.lastImport.snapshotVersion} testId="import-snapshot" />
            </dl>
            <Muted>
              {d.lastImport.mode === "commit" ? "Commit" : "Dry run"} · {d.lastImport.status} · started {when(d.lastImport.startedAt)}
            </Muted>
          </div>
        ) : (
          <Muted>No import on file.</Muted>
        )}
      </Panel>
    </div>
  );
}
