"use client";

import { useCallback, useEffect, useState } from "react";
import { complaintAction, evidenceLink, fetchComplaint, fetchComplaints, type AdminFailure, type AdminResult } from "@/client/admin/api";
import {
  CATEGORY_LABELS,
  nextStatuses,
  OUTCOME_CODES,
  OUTCOME_LABELS,
  QUEUE_LABELS,
  STATUS_LABELS,
  type ComplaintDetail,
  type ComplaintList,
  type ComplaintScope,
  type OutcomeCode,
} from "@/domain/admin/complaints";
import type { ComplaintStatus } from "@/domain/complaints/status";
import { btnPrimary, btnSecondary, Chip, ErrorNote, Field, inputCls, Muted, OkNote, PageTitle, Panel, when } from "./parts";
import { AdminStepUp } from "./step-up";

// A17 Complaint review (N7, C11). Private driver reports, for the complaint reviewer role only.
// Everything here needs a fresh step-up (15 minutes), and every read is logged: the queue, each
// report opened, each evidence link. The list never shows the text or the evidence; a report's
// evidence is metadata until the reviewer asks for one file, which comes as a 60-second download
// link (never a preview, never in the page). Outcomes are neutral: never a finding about a driver.

type Notice = { ok: boolean; text: string } | null;

const isStepUp = (r: AdminResult<unknown>): boolean => !r.ok && (r as AdminFailure).code === "step_up_required";

export function ComplaintsScreen() {
  const [scope, setScope] = useState<ComplaintScope>("open");
  const [state, setState] = useState<AdminResult<ComplaintList> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [stepUp, setStepUp] = useState<(() => void) | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [openKey, setOpenKey] = useState(0);

  // Bumped to load the list again (after a step-up or a change).
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    void fetchComplaints(scope).then((r) => {
      if (!live) return;
      if (isStepUp(r)) setStepUp(() => reload);
      setState(r);
    });
    return () => {
      live = false;
    };
  }, [scope, nonce, reload]);

  const askStepUp = useCallback((retry: () => void) => setStepUp(() => retry), []);

  return (
    <div data-testid="admin-complaints">
      <PageTitle lead="Private driver reports. Only complaint reviewers see this, after a fresh code; every list, report and evidence download is logged. Outcomes are neutral: a report is never a finding about a driver. You never see your own reports.">
        Complaint review
      </PageTitle>

      {stepUp ? (
        <AdminStepUp
          action="open driver reports"
          onVerified={() => {
            const retry = stepUp;
            setStepUp(null);
            retry();
          }}
          onCancel={() => setStepUp(null)}
        />
      ) : null}

      {notice ? <div className="my-4">{notice.ok ? <OkNote testId="complaint-notice">{notice.text}</OkNote> : <ErrorNote testId="complaint-notice">{notice.text}</ErrorNote>}</div> : null}

      <div className="my-4 flex gap-2" role="group" aria-label="Which reports">
        {(["open", "closed"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={scope === s ? btnPrimary : btnSecondary}
            aria-pressed={scope === s}
            onClick={() => {
              setOpenId(null);
              setScope(s);
            }}
            data-testid={`complaints-scope-${s}`}
          >
            {s === "open" ? "Open" : "Closed and withdrawn"}
          </button>
        ))}
      </div>

      {state === null ? (
        <Muted>Loading…</Muted>
      ) : !state.ok ? (
        isStepUp(state) ? <Muted>Confirm it is you to see the reports.</Muted> : <ErrorNote testId="complaints-error">{state.message}</ErrorNote>
      ) : state.data.complaints.length === 0 ? (
        <Muted>{scope === "open" ? "No open reports." : "No closed reports."}</Muted>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-fill bg-white dark:border-navy-raised dark:bg-navy">
          <table className="w-full text-left text-sm" data-testid="complaints-table">
            <caption className="sr-only">{scope === "open" ? "Open reports, priority first" : "Closed and withdrawn reports, newest first"}</caption>
            <thead className="border-b border-fill dark:border-navy-raised">
              <tr>
                {["Reference", "Category", "Queue", "Status", "Submitted", "Evidence", ""].map((h, i) => (
                  <th key={i} scope="col" className="px-3 py-2 font-semibold">
                    {h || <span className="sr-only">Actions</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.data.complaints.map((c) => (
                <tr key={c.id} className="border-b border-fill last:border-0 dark:border-navy-raised">
                  <th scope="row" className="px-3 py-2 font-mono font-medium">
                    {c.publicRef}
                    {c.legalHold ? (
                      <span className="ml-2">
                        <Chip tone="warn">Legal hold</Chip>
                      </span>
                    ) : null}
                  </th>
                  <td className="px-3 py-2">{CATEGORY_LABELS[c.category]}</td>
                  <td className="px-3 py-2">{c.queue === "queue_priority" ? <Chip tone="warn">{QUEUE_LABELS[c.queue]}</Chip> : QUEUE_LABELS[c.queue]}</td>
                  <td className="px-3 py-2">{STATUS_LABELS[c.status]}</td>
                  <td className="px-3 py-2">{when(c.submittedAt)}</td>
                  <td className="px-3 py-2 tabular-nums">{c.evidenceCount}</td>
                  <td className="px-3 py-2">
                    <button type="button" className={btnSecondary} onClick={() => setOpenId(c.id)} aria-label={`Open report ${c.publicRef}`} data-testid={`complaint-open-${c.id}`}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId ? (
        <div className="mt-6">
          <ComplaintDetailView
            key={`${openId}-${openKey}`}
            id={openId}
            askStepUp={askStepUp}
            onClose={() => setOpenId(null)}
            onChanged={async (text) => {
              setNotice({ ok: true, text });
              setOpenKey((k) => k + 1);
              reload();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function ComplaintDetailView({
  id,
  askStepUp,
  onClose,
  onChanged,
}: {
  id: string;
  askStepUp: (retry: () => void) => void;
  onClose: () => void;
  onChanged: (text: string) => Promise<void>;
}) {
  const [state, setState] = useState<AdminResult<ComplaintDetail> | null>(null);
  const [linkNote, setLinkNote] = useState<Notice>(null);

  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    void fetchComplaint(id).then((r) => {
      if (!live) return;
      if (isStepUp(r)) askStepUp(reload);
      setState(r);
    });
    return () => {
      live = false;
    };
  }, [id, askStepUp, nonce, reload]);

  const download = async (evidenceId: string, n: number) => {
    setLinkNote(null);
    const r = await evidenceLink(id, evidenceId);
    if (isStepUp(r)) return askStepUp(() => void download(evidenceId, n));
    if (!r.ok) return setLinkNote({ ok: false, text: r.message });
    setLinkNote({ ok: true, text: `File ${n} is downloading. The link works for 60 seconds and this download is logged.` });
    // The link is used at once and not kept: Content-Disposition attachment, so the page stays.
    window.location.assign(r.data.url);
  };

  if (state === null) return <Muted>Loading the report…</Muted>;
  if (!state.ok) return isStepUp(state) ? <Muted>Confirm it is you to open this report.</Muted> : <ErrorNote testId="complaint-error">{state.message}</ErrorNote>;
  const c = state.data;

  return (
    <Panel title={`Report ${c.publicRef}`} testId="complaint-detail">
      <div className="grid gap-5">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="font-medium">Category</dt>
          <dd>{CATEGORY_LABELS[c.category]}</dd>
          <dt className="font-medium">Status</dt>
          <dd>
            {STATUS_LABELS[c.status]}
            {c.outcomeCode ? ` (${OUTCOME_LABELS[c.outcomeCode]})` : ""}
          </dd>
          <dt className="font-medium">Queue</dt>
          <dd>{QUEUE_LABELS[c.queue]}</dd>
          <dt className="font-medium">When it happened</dt>
          <dd>{when(c.incidentAt)}</dd>
          <dt className="font-medium">Submitted</dt>
          <dd>{when(c.submittedAt)}</dd>
          <dt className="font-medium">Where</dt>
          <dd>
            {c.location.source === "gps" && c.location.lat !== null
              ? `GPS ${c.location.lat.toFixed(5)}, ${c.location.lng?.toFixed(5)}${c.location.accuracyM !== null ? ` (±${Math.round(c.location.accuracyM)} m)` : ""}`
              : c.location.text ?? "Not given"}
          </dd>
          <dt className="font-medium">Vehicle</dt>
          <dd>{[c.plate && `Plate ${c.plate}`, c.bodyNumber && `Body no. ${c.bodyNumber}`, c.operator && `Operator ${c.operator}`].filter(Boolean).join(" · ") || "Not given"}</dd>
          <dt className="font-medium">Retention</dt>
          <dd>{c.legalHold ? "On legal hold: not purged" : c.retentionUntil ? `Purged after ${when(c.retentionUntil)}` : "Kept until closed, then 365 days"}</dd>
        </dl>

        <section aria-label="What the reporter wrote">
          <h3 className="mb-1 text-sm font-semibold">What the reporter wrote</h3>
          <p className="whitespace-pre-wrap rounded-md bg-fill p-3 text-sm dark:bg-navy-deep" data-testid="complaint-description">
            {c.description}
          </p>
        </section>

        <section aria-label="Evidence">
          <h3 className="mb-1 text-sm font-semibold">Evidence ({c.evidence.length})</h3>
          {c.evidence.length === 0 ? (
            <Muted>No photo or video was attached.</Muted>
          ) : (
            <ul className="grid gap-2" data-testid="complaint-evidence">
              {c.evidence.map((e, i) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <span>
                    File {i + 1}: {e.mime ?? "unknown type"}
                    {e.bytes !== null ? `, ${Math.max(1, Math.round(e.bytes / 1024))} KB` : ""}, {e.captureKind === "in_app_camera" ? "taken in the app" : "uploaded"}, received {when(e.receivedAt)}
                  </span>
                  <button type="button" className={btnSecondary} disabled={!e.available} onClick={() => void download(e.id, i + 1)} data-testid={`evidence-download-${e.id}`}>
                    {e.available ? `Download file ${i + 1}` : "Not available"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {linkNote ? <div className="mt-2">{linkNote.ok ? <OkNote testId="evidence-note">{linkNote.text}</OkNote> : <ErrorNote testId="evidence-note">{linkNote.text}</ErrorNote>}</div> : null}
        </section>

        <section aria-label="History">
          <h3 className="mb-1 text-sm font-semibold">History</h3>
          <ol className="grid gap-1 text-sm" data-testid="complaint-history">
            {c.events.map((e, i) => (
              <li key={i}>
                {when(e.at)}: {e.from && e.from !== e.to ? `${label(e.from)} → ` : ""}
                {label(e.to)} by {e.actorRole === "reporter" ? "the reporter" : e.actorRole === "system" ? "the system" : e.mine ? "you" : "a reviewer"}
                {e.note ? ` – "${e.note}"` : ""}
                {e.visibility === "reviewer_only" ? " (reviewers only)" : e.note && e.actorRole === "complaint_reviewer" ? " (shown to the reporter)" : ""}
              </li>
            ))}
          </ol>
        </section>

        <section aria-label="Evidence downloads">
          <h3 className="mb-1 text-sm font-semibold">Evidence downloads</h3>
          {c.access.length === 0 ? (
            <Muted>Nobody has downloaded the evidence.</Muted>
          ) : (
            <ul className="grid gap-1 text-sm" data-testid="complaint-access">
              {c.access.map((a, i) => (
                <li key={i}>
                  {when(a.issuedAt)}: {a.accessorRole === "reporter" ? "the reporter" : a.mine ? "you" : "a reviewer"}
                </li>
              ))}
            </ul>
          )}
        </section>

        <StatusForm c={c} askStepUp={askStepUp} onChanged={onChanged} />
        <HoldForm c={c} askStepUp={askStepUp} onChanged={onChanged} />

        <div>
          <button type="button" className={btnSecondary} onClick={onClose}>
            Close the report
          </button>
        </div>
      </div>
    </Panel>
  );
}

const label = (s: string) => STATUS_LABELS[s as ComplaintStatus] ?? s;

function StatusForm({ c, askStepUp, onChanged }: { c: ComplaintDetail; askStepUp: (retry: () => void) => void; onChanged: (text: string) => Promise<void> }) {
  const options = nextStatuses(c.status);
  const [to, setTo] = useState<ComplaintStatus | "">(options[0] ?? "");
  const [outcome, setOutcome] = useState<OutcomeCode | "">("");
  const [note, setNote] = useState("");
  const [toReporter, setToReporter] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (options.length === 0) return <Muted>No further status change: this report is {label(c.status).toLowerCase()}.</Muted>;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError("");
    if (!to) return;
    if (to === "closed" && !outcome) return setError("Choose an outcome to close the report.");
    if (toReporter && !note.trim()) return setError("Write the note the reporter will see.");
    setBusy(true);
    const r = await complaintAction(c.id, {
      action: "status",
      to: to as "under_review" | "needs_information" | "closed",
      ...(to === "closed" ? { outcomeCode: outcome as OutcomeCode } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      visibility: toReporter ? "reporter" : "reviewer_only",
    });
    setBusy(false);
    if (isStepUp(r)) return askStepUp(() => void submit());
    if (!r.ok) return setError(r.message);
    await onChanged(`${c.publicRef} is now ${label(to).toLowerCase()}.`);
  };

  return (
    <form className="grid max-w-xl gap-3 border-t border-fill pt-4 dark:border-navy-raised" onSubmit={(e) => void submit(e)} aria-label="Change the status" data-testid="complaint-status-form">
      <h3 className="text-sm font-semibold">Change the status</h3>
      <Field label="New status">
        <select className={inputCls} value={to} onChange={(e) => setTo(e.target.value as ComplaintStatus)} data-testid="complaint-to">
          {options.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </Field>
      {to === "closed" ? (
        <Field label="Outcome" hint="Neutral wording; the reporter sees it.">
          <select className={inputCls} value={outcome} onChange={(e) => setOutcome(e.target.value as OutcomeCode)} data-testid="complaint-outcome">
            <option value="">Choose…</option>
            {OUTCOME_CODES.map((o) => (
              <option key={o} value={o}>
                {OUTCOME_LABELS[o]}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label="Note (optional)">
        <textarea className={inputCls} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} data-testid="complaint-note" />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={toReporter} onChange={(e) => setToReporter(e.target.checked)} data-testid="complaint-note-reporter" />
        Show this note to the reporter (otherwise reviewers only)
      </label>
      {error ? <ErrorNote testId="complaint-form-error">{error}</ErrorNote> : null}
      <div>
        <button type="submit" className={btnPrimary} disabled={busy} data-testid="complaint-submit">
          {busy ? "Saving…" : "Save the status"}
        </button>
      </div>
    </form>
  );
}

function HoldForm({ c, askStepUp, onChanged }: { c: ComplaintDetail; askStepUp: (retry: () => void) => void; onChanged: (text: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError("");
    if (note.trim().length < 3) return setError("Say why (at least 3 characters).");
    setBusy(true);
    const r = await complaintAction(c.id, { action: "legal_hold", hold: !c.legalHold, note: note.trim() });
    setBusy(false);
    if (isStepUp(r)) return askStepUp(() => void submit());
    if (!r.ok) return setError(r.message);
    await onChanged(c.legalHold ? `Legal hold lifted on ${c.publicRef}.` : `${c.publicRef} is on legal hold and will not be purged.`);
  };
  return (
    <form className="grid max-w-xl gap-3 border-t border-fill pt-4 dark:border-navy-raised" onSubmit={(e) => void submit(e)} aria-label="Legal hold" data-testid="complaint-hold-form">
      <h3 className="text-sm font-semibold">Legal hold</h3>
      <Muted>{c.legalHold ? "This report is on legal hold: the retention purge skips it." : "A legal hold stops the retention purge (for example, a request from the authorities)."}</Muted>
      <Field label="Reason (reviewers only)">
        <input className={inputCls} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} data-testid="complaint-hold-note" />
      </Field>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div>
        <button type="submit" className={btnSecondary} disabled={busy} data-testid="complaint-hold">
          {c.legalHold ? "Lift the legal hold" : "Put on legal hold"}
        </button>
      </div>
    </form>
  );
}
