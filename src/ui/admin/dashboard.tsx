"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { fetchDashboard, type AdminResult } from "@/client/admin/api";
import type { AdminDashboard as Dashboard } from "@/domain/admin/schemas";
import { Chip, ErrorNote, Muted, PageTitle, Panel, when, type ChipTone } from "./parts";

const linkCls = "font-medium text-teal-ink underline underline-offset-2 dark:text-teal-bright";
const DAY_MS = 86_400_000;

// A1 Dashboard (N5a, C1; redesigned N8): answers "is the network healthy, what needs me now" from
// the counts that exist in the database today (no extra endpoints). Transport staff see the data
// counts; a moderator only the moderation queue (N6), whose data endpoint is theirs.
export function AdminDashboard({
  transit,
  corrections,
  moderation,
  complaints = false,
}: {
  transit: boolean;
  corrections: boolean;
  moderation: boolean;
  complaints?: boolean;
}) {
  const [state, setState] = useState<AdminResult<Dashboard> | null>(null);
  const [now, setNow] = useState(0); // set when the data arrives, so render stays pure
  useEffect(() => {
    if (!transit) return;
    let live = true;
    void fetchDashboard().then((r) => {
      if (!live) return;
      setNow(Date.now());
      setState(r);
    });
    return () => {
      live = false;
    };
  }, [transit]);

  return (
    <div data-testid="admin-dashboard">
      <PageTitle lead="What is published, what is waiting, and the last import. Counts only; nothing here changes data.">Dashboard</PageTitle>
      <div className="grid gap-4">
        {!transit ? null : state === null ? (
          <Muted>Loading…</Muted>
        ) : !state.ok ? (
          <ErrorNote testId="admin-dashboard-error">{state.message}</ErrorNote>
        ) : (
          <Attention d={state.data} corrections={corrections} />
        )}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {transit && state?.ok ? <Cards d={state.data} corrections={corrections} now={now} /> : null}
          {moderation ? (
            <Panel title="Community moderation" testId="card-moderation">
              <Muted>Posts, comments and photos waiting for a person, and appeals to decide.</Muted>
              <p className="mt-3 text-sm">
                <Link href="/admin/moderation" prefetch={false} className={linkCls}>
                  Moderation and appeals
                </Link>
              </p>
            </Panel>
          ) : null}
          {complaints ? (
            <Panel title="Driver reports" testId="card-complaints">
              <Muted>Private driver reports waiting for review. Opening them needs a fresh code, and every read is logged.</Muted>
              <p className="mt-3 text-sm">
                <Link href="/admin/complaints" prefetch={false} className={linkCls}>
                  Complaint review
                </Link>
              </p>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type Item = { tone: ChipTone; chip: string; text: ReactNode; href?: string; cta?: string };

/** The few things that need a person now, worst first. Only facts the dashboard already has. */
function attentionItems(d: Dashboard, corrections: boolean): Item[] {
  const items: Item[] = [];
  const draft = d.latestDraft;
  if (!d.published) items.push({ tone: "error", chip: "Blocked", text: "Nothing is published, so riders have no network data.", href: "/admin/revisions", cta: "Open revisions" });
  if (draft) {
    if (draft.validationOk === null) items.push({ tone: "warn", chip: "Draft", text: `${draft.label} has not been validated yet.`, href: "/admin/revisions", cta: "Validate" });
    else if (!draft.validationCurrent) items.push({ tone: "warn", chip: "Draft", text: `${draft.label} changed since its last validation.`, href: "/admin/revisions", cta: "Validate again" });
    else if (!draft.validationOk) items.push({ tone: "error", chip: "Draft", text: `${draft.label} failed validation.`, href: "/admin/revisions", cta: "See the errors" });
    else items.push({ tone: "ok", chip: "Draft", text: `${draft.label} passed validation and can be published.`, href: "/admin/revisions", cta: "Review and publish" });
  }
  if (d.stopCandidates > 0) {
    items.push({ tone: "warn", chip: "Stops", text: `${d.stopCandidates} stop candidate${d.stopCandidates === 1 ? "" : "s"} still to review.`, href: "/admin/candidates", cta: "Review candidates" });
  }
  if (corrections && d.openCorrections > 0) {
    items.push({ tone: "warn", chip: "Corrections", text: `${d.openCorrections} open correction${d.openCorrections === 1 ? "" : "s"} from commuters.`, href: "/admin/corrections", cta: "Review corrections" });
  }
  return items;
}

function Attention({ d, corrections }: { d: Dashboard; corrections: boolean }) {
  const items = attentionItems(d, corrections);
  return (
    <Panel title="Needs your attention" testId="card-attention">
      {items.length === 0 ? (
        <p className="flex items-center gap-3 text-sm">
          <Chip tone="ok">All clear</Chip>
          <span>Nothing is waiting on you. A published revision is live and no draft, candidate or correction is open.</span>
        </p>
      ) : (
        <ul className="divide-y divide-ink-3/20 dark:divide-navy-raised">
          {items.map((i) => (
            <li key={i.chip + i.cta} className="grid gap-x-4 gap-y-1.5 py-3 first:pt-0 last:pb-0 sm:grid-cols-[7.5rem_1fr_auto] sm:items-center">
              <span>
                <Chip tone={i.tone}>{i.chip}</Chip>
              </span>
              <span className="min-w-0 text-sm">{i.text}</span>
              {i.href ? (
                <Link href={i.href} prefetch={false} className={`${linkCls} text-sm`}>
                  {i.cta}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Stat({ label, value, testId }: { label: string; value: string | number; testId: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-2 dark:text-slate-300">{label}</dt>
      <dd className="mt-0.5 break-words text-2xl font-semibold tabular-nums tracking-tight" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

/** Whole days since an ISO time; "today" below one day. */
function ageText(iso: string | null, now: number): string {
  if (!iso || !now) return "";
  const days = Math.floor((now - new Date(iso).getTime()) / DAY_MS);
  return days < 1 ? "published today" : `published ${days} day${days === 1 ? "" : "s"} ago`;
}

function Cards({ d, corrections, now }: { d: Dashboard; corrections: boolean; now: number }) {
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
  const draftTone: ChipTone = !draft ? "plain" : draft.validationOk === null || !draft.validationCurrent ? "warn" : draft.validationOk ? "ok" : "error";
  const share = d.stopsTotal > 0 ? Math.min(100, Math.round((d.stopCandidates / d.stopsTotal) * 100)) : 0;
  return (
    <>
      <Panel title="Published revision" testId="card-published">
        {d.published ? (
          <div className="grid gap-3">
            <dl>
              <Stat label="Label" value={d.published.label} testId="published-label" />
            </dl>
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2 dark:text-slate-300">
              <Chip tone={d.published.kind === "provisional" ? "warn" : "ok"}>{d.published.kind === "provisional" ? "Provisional (unverified data)" : "Verified"}</Chip>
              <span>
                #{d.published.seq} · {ageText(d.published.publishedAt, now) || `published ${when(d.published.publishedAt)}`}
              </span>
            </p>
            <Muted>Published {when(d.published.publishedAt)}</Muted>
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
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2 dark:text-slate-300">
            <Chip tone={draftTone}>{draftState}</Chip>
            {draft ? <span>{draft.label}</span> : null}
          </p>
        </div>
        <p className="mt-3 text-sm">
          <Link href="/admin/revisions" prefetch={false} className={linkCls}>
            Revisions and publication
          </Link>
        </p>
      </Panel>
      <Panel title="Stops in the published revision" testId="card-stops">
        <dl className="grid grid-cols-2 gap-3">
          <Stat label="Candidates to review" value={d.stopCandidates} testId="stop-candidates" />
          <Stat label="All stops" value={d.stopsTotal} testId="stops-total" />
        </dl>
        <div
          className="mt-4 h-2 overflow-hidden rounded-full bg-fill dark:bg-navy-raised"
          role="img"
          aria-label={`${d.stopCandidates} of ${d.stopsTotal} stops are still candidates (${share}%)`}
        >
          <div className="h-full rounded-full bg-teal dark:bg-teal-bright" style={{ width: `${share}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-ink-2 dark:text-slate-300">{share}% of stops are still candidates</p>
      </Panel>
      <Panel title="Corrections" testId="card-corrections">
        <dl>
          <Stat label="Open (submitted, under review, needs evidence)" value={d.openCorrections} testId="open-corrections" />
        </dl>
        {corrections ? (
          <p className="mt-3 text-sm">
            <Link href="/admin/corrections" prefetch={false} className={linkCls}>
              Corrections review
            </Link>
          </p>
        ) : null}
      </Panel>
      <Panel title="Last import" testId="card-import">
        {d.lastImport ? (
          <div className="grid gap-2">
            <dl>
              <Stat label="Snapshot" value={d.lastImport.snapshotVersion} testId="import-snapshot" />
            </dl>
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2 dark:text-slate-300">
              <Chip>{d.lastImport.mode === "commit" ? "Commit" : "Dry run"}</Chip>
              <Chip>{d.lastImport.status}</Chip>
              <span>started {when(d.lastImport.startedAt)}</span>
            </p>
          </div>
        ) : (
          <Muted>No import on file.</Muted>
        )}
      </Panel>
    </>
  );
}
