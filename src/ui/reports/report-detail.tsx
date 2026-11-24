"use client";

// One of the person's own reports (S19 detail, task B9): the Lunad status timeline (events the
// reporter may see), what they wrote (their own content, visible to them only), and, for a driver
// report, a SEPARATE "MyNaga (self-reported)" panel. That panel shows only what the person told
// us; Lunad never sends anything to MyNaga or City Hall and cannot confirm it was received.

import "@/ui/kit/styles";
import "@/ui/report/report.css";
import "./reports.css";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useAuthSession } from "@/client/auth/use-auth-session";
import { SignInUnknown } from "@/ui/auth/sign-in-unknown";
import { loadComplaint, loadCorrection, type Loaded } from "@/client/reports/api";
import { complaintCategoryLabel } from "@/domain/complaints/categories";
import { complaintStatusLabel } from "@/domain/complaints/status";
import { categoryLabel } from "@/domain/corrections/categories";
import { reviewReasonText } from "@/domain/corrections/review-reasons";
import { statusLabel } from "@/domain/corrections/status";
import { complaintTone, correctionTone, manilaDate, outcomeLabel } from "@/domain/reports/list";
import { canWithdraw, COMPLAINT_FILES_MAX, CORRECTION_PHOTOS_MAX, type ComplaintDetail, type CorrectionDetail } from "@/domain/reports/schemas";
import { en, translated } from "@/i18n/dict";
import { useLocale, useT } from "@/i18n/provider";
import { Live, updateThenFocus } from "@/ui/report/form-a11y";
import { AnswerForm, WithdrawButton } from "./report-actions";
import { StatusChip } from "./reports-screen";

export const MYNAGA_PANEL_NOTE = en.reports.mynagaPanelNote;

type Timeline = { status: string; at: string; note?: string | null; own?: boolean }[];

/** What the screen gives the actions: reload the report, then say what happened. */
type Actions = {
  sent: () => Promise<void>;
  changed: (unsent?: string) => Promise<void>;
  withdrawn: () => Promise<void>;
};

function TimelineList({ events, label }: { events: Timeline; label: (status: string) => string }) {
  const locale = useLocale();
  const t = useT().reports;
  return (
    <ol className="pn-reports__timeline" data-testid="report-timeline">
      {events.map((e, i) => (
        <li key={`${e.status}-${e.at}-${i}`}>
          <span className="pn-reports__event">{label(e.status)}</span>
          <span className="pn-reports__when">{manilaDate(e.at, locale)}</span>
          {e.note ? (
            <span className="pn-reports__note">
              {e.own ? <strong className="pn-reports__you">{t.answer.youAnswered}: </strong> : null}
              {e.note}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function Fact({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div>
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ComplaintView({ c, act }: { c: ComplaintDetail; act: Actions }) {
  const tt = useT();
  const t = tt.reports;
  const d = tt.driverReport;
  const locale = useLocale();
  const outcome = outcomeLabel(c.outcomeCode, t);
  return (
    <>
      <div className="pn-reports__panel">
        <h2 data-testid="report-ref">{c.reference}</h2>
        <StatusChip tone={complaintTone(c.status)}>{complaintStatusLabel(c.status, d)}</StatusChip>
        {outcome ? <p className="pn-reports__note">{outcome}.</p> : null}
        <h3>{t.statusInParaNaga}</h3>
        <TimelineList events={c.events} label={(s) => complaintStatusLabel(s as ComplaintDetail["status"], d)} />
      </div>

      {c.status === "needs_information" ? (
        <div className="pn-reports__panel" data-testid="report-next-step">
          <AnswerForm kind="complaint" id={c.id} room={Math.max(0, Math.min(3, COMPLAINT_FILES_MAX - c.evidence.length))} onSent={act.sent} onChanged={act.changed} />
        </div>
      ) : null}

      <div className="pn-reports__panel" data-testid="report-content">
        <h3>{t.whatYouReported}</h3>
        <dl className="pn-reports__kv">
          <Fact name={t.facts.category}>{complaintCategoryLabel(c.category, d)}</Fact>
          <Fact name={t.facts.when}>{manilaDate(c.incidentAt, locale)}</Fact>
          {c.locationText ? <Fact name={t.facts.where}>{c.locationText}</Fact> : null}
          {c.operator ? <Fact name={t.facts.operator}>{c.operator}</Fact> : null}
          {c.plate ? <Fact name={t.facts.plate}>{c.plate}</Fact> : null}
          {c.bodyNumber ? <Fact name={t.facts.body}>{c.bodyNumber}</Fact> : null}
          <Fact name={t.facts.whatHappened}>{c.description}</Fact>
          <Fact name={t.facts.media}>{c.evidence.length === 0 ? t.none : String(c.evidence.length)}</Fact>
        </dl>
      </div>

      <section className="pn-reports__panel" aria-labelledby="pn-report-mynaga" data-testid="report-mynaga-panel">
        <h3 id="pn-report-mynaga">{t.mynagaTitle}</h3>
        <p className="pn-reports__intro" data-testid="report-mynaga-state">
          {c.handoff.submitted
            ? c.handoff.submittedAt
              ? t.saidSubmittedOn(manilaDate(c.handoff.submittedAt, locale))
              : t.saidSubmitted
            : t.notSaid}
          {c.handoff.reference ? t.yourReference(c.handoff.reference) : ""}
        </p>
        <p className="pn-reports__note">{t.mynagaPanelNote}</p>
        <Link href={`/app/mynaga?report=${c.id}`} className="pn-btn pn-btn--primary pn-report__action" data-testid="report-mynaga-link">
          {c.handoff.submitted ? t.openSteps : t.continueMyNaga}
        </Link>
      </section>

      {canWithdraw(c.status) || c.status === "under_review" ? (
        <div className="pn-reports__panel" data-testid="report-withdraw">
          {canWithdraw(c.status) ? <WithdrawButton id={c.id} onDone={act.withdrawn} onChanged={() => act.changed()} /> : <p className="pn-reports__note">{t.withdraw.underReview}</p>}
        </div>
      ) : null}
    </>
  );
}

function CorrectionView({ c, act }: { c: CorrectionDetail; act: Actions }) {
  const tt = useT();
  const t = tt.reports;
  const r = tt.report;
  return (
    <>
      <div className="pn-reports__panel">
        <h2>{categoryLabel(c.category, r)}</h2>
        <StatusChip tone={correctionTone(c.status)}>{statusLabel(c.status, r)}</StatusChip>
        <h3>{t.statusInParaNaga}</h3>
        <TimelineList
          events={c.events.map((e) => ({ status: e.status, at: e.at, note: e.answer ?? (e.reason ? reviewReasonText(e.reason, r) : null), own: Boolean(e.answer) }))}
          label={(s) => statusLabel(s as CorrectionDetail["status"], r)}
        />
      </div>
      {c.status === "needs_evidence" ? (
        <div className="pn-reports__panel" data-testid="report-next-step">
          <AnswerForm kind="correction" id={c.id} room={Math.max(0, CORRECTION_PHOTOS_MAX - c.photoCount)} onSent={act.sent} onChanged={act.changed} />
        </div>
      ) : null}
      <div className="pn-reports__panel" data-testid="report-content">
        <h3>{t.whatYouReported}</h3>
        <dl className="pn-reports__kv">
          {c.entityLabel ? <Fact name={t.facts.about}>{c.entityLabel}</Fact> : null}
          <Fact name={t.facts.details}>{c.description}</Fact>
        </dl>
      </div>
    </>
  );
}

type View = { phase: "loading" } | { phase: "error"; message: string } | { phase: "complaint"; data: ComplaintDetail } | { phase: "correction"; data: CorrectionDetail };

/**
 * The router keeps a page it has left mounted but hidden, with its state, so leaving drops what was
 * typed and chosen (an answer is private): effects clean up on hiding, and the new key replaces the
 * screen by an empty one.
 */
export function ReportDetailScreen(props: { kind: "complaint" | "correction"; id: string }) {
  const [visit, setVisit] = useState(0);
  useEffect(() => () => setVisit((n) => n + 1), []);
  return <Detail key={`${visit}:${props.kind}:${props.id}`} {...props} />;
}

function Detail({ kind, id }: { kind: "complaint" | "correction"; id: string }) {
  const tt = useT();
  const { user, loading, status, refresh, refreshing } = useAuthSession();
  const [view, setView] = useState<View>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const loadingRef = useRef<HTMLParagraphElement>(null);
  const noteRef = useRef<HTMLParagraphElement>(null);
  const [note, setNote] = useState<string | null>(null);
  // What the person typed when the report changed under them, so it is not lost with the form.
  const [unsent, setUnsent] = useState<string | null>(null);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let live = true;
    const done = <T,>(r: Loaded<T>, make: (data: T) => View) => {
      if (live) setView(r.ok ? make(r.data) : { phase: "error", message: r.message });
    };
    if (kind === "complaint") void loadComplaint(id).then((r) => done(r, (data) => ({ phase: "complaint", data })));
    else void loadCorrection(id).then((r) => done(r, (data) => ({ phase: "correction", data })));
    return () => {
      live = false;
    };
  }, [userId, kind, id, attempt]);

  // Reloads the report, then says what happened and moves focus there: the control that held it is gone.
  const settle = async (message: string, kept: string | null = null) => {
    const r = kind === "complaint" ? await loadComplaint(id) : await loadCorrection(id);
    // The answer arrived but its response did not, and the retry was told the report changed.
    const events = r.ok ? r.data.events : [];
    if (kept !== null && events.some((e) => ("own" in e ? e.own && e.note === kept : e.answer === kept))) {
      message = tt.reports.answer.sent;
      kept = null;
    }
    flushSync(() => {
      if (!r.ok) setView({ phase: "error", message: r.message });
      else if (kind === "complaint") setView({ phase: "complaint", data: r.data as ComplaintDetail });
      else setView({ phase: "correction", data: r.data as CorrectionDetail });
      setNote(message);
      setUnsent(kept);
    });
    noteRef.current?.focus();
  };
  const act: Actions = {
    sent: () => settle(tt.reports.answer.sent),
    changed: (kept) => settle(tt.reports.api.changed, kept ?? null),
    withdrawn: () => settle(tt.reports.withdraw.done),
  };
  const asking = (view.phase === "complaint" && view.data.status === "needs_information") || (view.phase === "correction" && view.data.status === "needs_evidence");

  if (loading) {
    return (
      <p className="pn-reports__intro" role="status">
        {tt.forms.loading}
      </p>
    );
  }
  if (status === "unknown") return <SignInUnknown onRetry={() => void refresh()} busy={refreshing} />;
  if (!user) {
    return (
      <div className="pn-report__signin" data-testid="reports-signin">
        <p>{tt.reports.signInOne}</p>
        <Link href="/app/sign-in" className="pn-btn pn-btn--primary pn-report__action">
          {tt.forms.signIn}
        </Link>
      </div>
    );
  }
  return (
    <div className="pn-reports" data-testid="report-detail">
      <Live ref={noteRef} tabIndex={-1} className="pn-report__status pn-reports__live" data-testid="report-note">
        {note}
      </Live>
      {unsent && !asking ? (
        <section className="pn-reports__panel" aria-labelledby="pn-unsent" data-testid="report-unsent">
          <h3 id="pn-unsent">{tt.reports.answer.unsentTitle}</h3>
          <p className="pn-reports__note">{tt.reports.answer.unsentBody}</p>
          <label htmlFor="pn-unsent-text" className="pn-report__label">
            {tt.reports.answer.unsentLabel}
          </label>
          <textarea id="pn-unsent-text" readOnly rows={4} className="pn-report__input pn-report__textarea" value={unsent} />
        </section>
      ) : null}
      {view.phase === "loading" ? (
        <p ref={loadingRef} tabIndex={-1} className="pn-reports__intro" role="status">
          {tt.forms.loading}
        </p>
      ) : null}
      {view.phase === "error" ? (
        <div className="pn-report__error" data-testid="report-error">
          <p role="alert">{translated(view.message, en.reports.api, tt.reports.api)}</p>
          <button
            type="button"
            className="pn-btn pn-btn--secondary pn-report__action"
            onClick={() =>
              updateThenFocus(
                () => {
                  setView({ phase: "loading" });
                  setAttempt((n) => n + 1);
                },
                () => loadingRef.current,
              )
            }
          >
            {tt.forms.tryAgain}
          </button>
        </div>
      ) : null}
      {view.phase === "complaint" ? <ComplaintView c={view.data} act={act} /> : null}
      {view.phase === "correction" ? <CorrectionView c={view.data} act={act} /> : null}
      <Link href="/app/reports" className="pn-btn pn-btn--secondary pn-report__action">
        {tt.reports.allMine}
      </Link>
    </div>
  );
}
