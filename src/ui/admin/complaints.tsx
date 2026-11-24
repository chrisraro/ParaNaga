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
import { btnPrimary, btnRow, btnSecondary, Chip, ErrorNote, Field, inputCls, Muted, PageTitle, Panel, when, Empty, insetCls, Loading, ResultNotice, LoadError, ConfirmStep, segBtn, segGroup, useFormProblem, type Notice, TableScroll } from "./parts";
import { AdminStepUp } from "./step-up";

// A17 Complaint review (N7, C11). Private driver reports, for the complaint reviewer role only.
// Everything here needs a fresh step-up (15 minutes), and every read is logged: the queue, each
// report opened, each evidence link. The list never shows the text or the evidence; a report's
// evidence is metadata until the reviewer asks for one file, which comes as a 60-second download
// link (never a preview, never in the page). Outcomes are neutral: never a finding about a driver.

/** The queue. `needsStepUp` is its own state so that closing the code panel leaves a way back in. */
type ListState = { step: "loading" } | { step: "needsStepUp" } | { step: "error"; message: string } | { step: "ready"; data: ComplaintList };
const LOADING: ListState = { step: "loading" };

const isStepUp = (r: AdminResult<unknown>): boolean => !r.ok && (r as AdminFailure).code === "step_up_required";

export function ComplaintsScreen() {
  const [scope, setScope] = useState<ComplaintScope>("open");
  const [list, setList] = useState<ListState>(LOADING);
  const [openId, setOpenId] = useState<string | null>(null);
  const [stepUp, setStepUp] = useState<(() => void) | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [openKey, setOpenKey] = useState(0);
  // After a change the report reloads in place; focus stays on the result notice, not the report heading.
  const [reloaded, setReloaded] = useState(false);

  // Bumped to load the list again (after a step-up or a change).
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  // After a step-up the queue starts over (nothing was shown); after a change the rows stay up while it reloads.
  const retryList = useCallback(() => {
    setList(LOADING);
    reload();
  }, [reload]);

  useEffect(() => {
    let live = true;
    void fetchComplaints(scope).then((r) => {
      if (!live) return;
      if (isStepUp(r)) setStepUp(() => retryList);
      setList(r.ok ? { step: "ready", data: r.data } : isStepUp(r) ? { step: "needsStepUp" } : { step: "error", message: r.message });
    });
    return () => {
      live = false;
    };
  }, [scope, nonce, retryList]);

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

      {notice ? (
        <div className="my-4">
          <ResultNotice notice={notice} testId="complaint-notice" />
        </div>
      ) : null}

      <div className={`my-4 ${segGroup}`} role="group" aria-label="Which reports">
        {(["open", "closed"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={segBtn}
            aria-pressed={scope === s}
            onClick={() => {
              setOpenId(null);
              // The other scope's rows never sit under this scope's caption while it loads.
              if (s !== scope) setList(LOADING);
              setScope(s);
            }}
            data-testid={`complaints-scope-${s}`}
          >
            {s === "open" ? "Open" : "Closed and withdrawn"}
          </button>
        ))}
      </div>

      {list.step === "loading" ? (
        <Loading />
      ) : list.step === "needsStepUp" ? (
        <div className="grid justify-items-start gap-2">
          <Muted>Confirm it is you to see the reports.</Muted>
          <button type="button" className={btnSecondary} onClick={() => askStepUp(retryList)} data-testid="complaints-step-up">
            Enter a code
          </button>
        </div>
      ) : list.step === "error" ? (
        <LoadError testId="complaints-error" onRetry={retryList}>{list.message}</LoadError>
      ) : list.data.complaints.length === 0 ? (
        <Empty title={scope === "open" ? "No open reports." : "No closed reports."}>Reports appear here when a commuter files one.</Empty>
      ) : (
        <TableScroll label="Reports" card>
          <table className="w-full text-left text-sm" data-testid="complaints-table">
            <caption className="sr-only">{scope === "open" ? "Open reports, priority first" : "Closed and withdrawn reports, newest first"}</caption>
            <thead>
              <tr>
                {["Reference", "Category", "Queue", "Status", "Submitted", "Evidence", ""].map((h, i) => (
                  <th key={i} scope="col">
                    {h || <span className="sr-only">Actions</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data.complaints.map((c) => (
                <tr key={c.id}>
                  <th scope="row" className="font-mono font-medium">
                    {c.publicRef}
                    {c.legalHold ? (
                      <span className="ml-2">
                        <Chip tone="warn">Legal hold</Chip>
                      </span>
                    ) : null}
                  </th>
                  <td>{CATEGORY_LABELS[c.category]}</td>
                  <td>{c.queue === "queue_priority" ? <Chip tone="warn">{QUEUE_LABELS[c.queue]}</Chip> : QUEUE_LABELS[c.queue]}</td>
                  <td>{STATUS_LABELS[c.status]}</td>
                  <td>{when(c.submittedAt)}</td>
                  <td className="adm-num">{c.evidenceCount}</td>
                  <td>
                    <button type="button" className={btnRow} onClick={() => {
                        setReloaded(false);
                        setOpenId(c.id);
                      }} aria-label={`Open report ${c.publicRef}`} data-testid={`complaint-open-${c.id}`}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}

      {openId ? (
        <div className="mt-6">
          <ComplaintDetailView
            key={`${openId}-${openKey}`}
            id={openId}
            focusHeading={!reloaded}
            askStepUp={askStepUp}
            onClose={() => setOpenId(null)}
            onChanged={async (text) => {
              setNotice({ ok: true, text });
              setOpenKey((k) => k + 1);
              setReloaded(true);
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
  focusHeading,
  askStepUp,
  onClose,
  onChanged,
}: {
  id: string;
  focusHeading: boolean;
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

  if (state === null) return <Loading>Loading the report…</Loading>;
  if (!state.ok) {
    if (!isStepUp(state)) {
      return (
        <LoadError
          testId="complaint-error"
          onRetry={() => {
            setState(null);
            reload();
          }}
        >
          {state.message}
        </LoadError>
      );
    }
    return (
      <div className="grid justify-items-start gap-2">
        <Muted>Confirm it is you to open this report.</Muted>
        <button type="button" className={btnSecondary} onClick={() => askStepUp(reload)}>
          Enter a code
        </button>
      </div>
    );
  }
  const c = state.data;

  return (
    <Panel title={`Report ${c.publicRef}`} testId="complaint-detail" focusOnOpen={focusHeading || "return-only"}>
      <div className="grid gap-5">
        <dl className="break-words grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
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
          <p className={`whitespace-pre-wrap p-3 text-sm ${insetCls}`} data-testid="complaint-description">
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
          {linkNote ? (
            <div className="mt-2">
              <ResultNotice notice={linkNote} testId="evidence-note" />
            </div>
          ) : null}
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
  const problem = useFormProblem();
  const [busy, setBusy] = useState(false);
  // Closed has no next status: saving it asks once more, in words (A9, WCAG 3.3.4).
  const [confirming, setConfirming] = useState(false);
  if (options.length === 0) return <Muted>No further status change: this report is {label(c.status).toLowerCase()}.</Muted>;

  const submit = async (e?: React.FormEvent, confirmed = false) => {
    e?.preventDefault();
    if (busy) return;
    problem.clear();
    setConfirming(false);
    if (!to) return;
    if (to === "closed" && !outcome) return problem.fail("Choose an outcome to close the report.", "outcome");
    if (toReporter && !note.trim()) return problem.fail("Write the note the reporter will see.", "note");
    if (to === "closed" && !confirmed) return setConfirming(true);
    setBusy(true);
    const r = await complaintAction(c.id, {
      action: "status",
      expectedStatus: c.status,
      to: to as "under_review" | "needs_information" | "closed",
      ...(to === "closed" ? { outcomeCode: outcome as OutcomeCode } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      visibility: toReporter ? "reporter" : "reviewer_only",
    });
    setBusy(false);
    if (isStepUp(r)) return askStepUp(() => void submit(undefined, confirmed));
    if (!r.ok) return problem.fail(r.message);
    await onChanged(`${c.publicRef} is now ${label(to).toLowerCase()}.`);
  };

  return (
    <form className="grid max-w-xl gap-3 border-t border-border pt-4 dark:border-night-border" onSubmit={(e) => void submit(e)} aria-label="Change the status" data-testid="complaint-status-form">
      <h3 className="text-sm font-semibold">Change the status</h3>
      <Field label="New status">
        <select className={inputCls} value={to} onChange={(e) => {
            // The outcome field comes and goes with the status: an old problem must not come back with it.
            problem.clear();
            setTo(e.target.value as ComplaintStatus);
          }} data-testid="complaint-to">
          {options.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </Field>
      {to === "closed" ? (
        <Field label="Outcome" hint="Neutral wording; the reporter sees it." error={problem.errorFor("outcome")} errorTestId="complaint-form-error">
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
      <Field label={toReporter ? "Note (required when shown to the reporter)" : "Note (optional)"} error={problem.errorFor("note")} errorTestId="complaint-form-error">
        <textarea className={inputCls} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} data-testid="complaint-note" />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={toReporter} onChange={(e) => setToReporter(e.target.checked)} data-testid="complaint-note-reporter" />
        Show this note to the reporter (otherwise reviewers only)
      </label>
      {problem.general ? <ErrorNote testId="complaint-form-error">{problem.general}</ErrorNote> : null}
      <div>
        <button type="submit" className={btnPrimary} aria-disabled={busy} data-testid="complaint-submit">
          {busy ? "Saving…" : to === "closed" ? "Close the report…" : "Save the status"}
        </button>
      </div>
      {confirming && outcome ? (
        <ConfirmStep title={`Close ${c.publicRef}?`} go="Close the report" onGo={() => void submit(undefined, true)} onCancel={() => setConfirming(false)} testId="complaint-close-confirm">
          {`A closed report cannot be opened again. The reporter sees the outcome “${OUTCOME_LABELS[outcome]}”${toReporter ? " and your note" : ""}.`}
        </ConfirmStep>
      ) : null}
    </form>
  );
}

function HoldForm({ c, askStepUp, onChanged }: { c: ComplaintDetail; askStepUp: (retry: () => void) => void; onChanged: (text: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const problem = useFormProblem();
  const [busy, setBusy] = useState(false);
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    problem.clear();
    if (note.trim().length < 3) return problem.fail("Say why (at least 3 characters).", "reason");
    setBusy(true);
    const r = await complaintAction(c.id, { action: "legal_hold", hold: !c.legalHold, note: note.trim() });
    setBusy(false);
    if (isStepUp(r)) return askStepUp(() => void submit());
    if (!r.ok) return problem.fail(r.message);
    await onChanged(c.legalHold ? `Legal hold lifted on ${c.publicRef}.` : `${c.publicRef} is on legal hold and will not be purged.`);
  };
  return (
    <form className="grid max-w-xl gap-3 border-t border-border pt-4 dark:border-night-border" onSubmit={(e) => void submit(e)} aria-label="Legal hold" data-testid="complaint-hold-form">
      <h3 className="text-sm font-semibold">Legal hold</h3>
      <Muted>{c.legalHold ? "This report is on legal hold: the retention purge skips it." : "A legal hold stops the retention purge (for example, a request from the authorities)."}</Muted>
      <Field label="Reason (reviewers only)" hint="At least 3 characters." error={problem.errorFor("reason")}>
        <input className={inputCls} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} data-testid="complaint-hold-note" />
      </Field>
      {problem.general ? <ErrorNote>{problem.general}</ErrorNote> : null}
      <div>
        <button type="submit" className={btnSecondary} aria-disabled={busy} aria-busy={busy} data-testid="complaint-hold">
          {c.legalHold ? "Lift the legal hold" : "Put on legal hold"}
        </button>
      </div>
    </form>
  );
}
