"use client";

// One of the person's own reports (S19 detail, task B9): the ParaNaga status timeline (events the
// reporter may see), what they wrote (their own content, visible to them only), and, for a driver
// report, a SEPARATE "MyNaga (self-reported)" panel. That panel shows only what the person told
// us; ParaNaga never sends anything to MyNaga or City Hall and cannot confirm it was received.

import "@/ui/kit/styles";
import "@/ui/report/report.css";
import "./reports.css";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useAuthSession } from "@/client/auth/use-auth-session";
import { loadComplaint, loadCorrection, type Loaded } from "@/client/reports/api";
import { complaintCategoryLabel } from "@/domain/complaints/categories";
import { complaintStatusLabel } from "@/domain/complaints/status";
import { categoryLabel } from "@/domain/corrections/categories";
import { reviewReasonText } from "@/domain/corrections/review-reasons";
import { statusLabel } from "@/domain/corrections/status";
import { complaintTone, correctionTone, manilaDate, outcomeLabel } from "@/domain/reports/list";
import type { ComplaintDetail, CorrectionDetail } from "@/domain/reports/schemas";
import { en, translated } from "@/i18n/dict";
import { useLocale, useT } from "@/i18n/provider";
import { StatusChip } from "./reports-screen";

export const MYNAGA_PANEL_NOTE = en.reports.mynagaPanelNote;

type Timeline = { status: string; at: string; note?: string | null }[];

function TimelineList({ events, label }: { events: Timeline; label: (status: string) => string }) {
  const locale = useLocale();
  return (
    <ol className="pn-reports__timeline" data-testid="report-timeline">
      {events.map((e, i) => (
        <li key={`${e.status}-${e.at}-${i}`}>
          <span className="pn-reports__event">{label(e.status)}</span>
          <span className="pn-reports__when">{manilaDate(e.at, locale)}</span>
          {e.note ? <span className="pn-reports__note">{e.note}</span> : null}
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

function ComplaintView({ c }: { c: ComplaintDetail }) {
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
    </>
  );
}

function CorrectionView({ c }: { c: CorrectionDetail }) {
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
          events={c.events.map((e) => ({ status: e.status, at: e.at, note: e.reason ? reviewReasonText(e.reason, r) : null }))}
          label={(s) => statusLabel(s as CorrectionDetail["status"], r)}
        />
      </div>
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

export function ReportDetailScreen({ kind, id }: { kind: "complaint" | "correction"; id: string }) {
  const tt = useT();
  const { user, loading } = useAuthSession();
  const [view, setView] = useState<View>({ phase: "loading" });
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
  }, [userId, kind, id]);

  if (loading) {
    return (
      <p className="pn-reports__intro" role="status">
        {tt.forms.loading}
      </p>
    );
  }
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
      {view.phase === "loading" ? (
        <p className="pn-reports__intro" role="status">
          {tt.forms.loading}
        </p>
      ) : null}
      {view.phase === "error" ? (
        <div className="pn-report__error" role="alert">
          {translated(view.message, en.reports.api, tt.reports.api)}
        </div>
      ) : null}
      {view.phase === "complaint" ? <ComplaintView c={view.data} /> : null}
      {view.phase === "correction" ? <CorrectionView c={view.data} /> : null}
      <Link href="/app/reports" className="pn-btn pn-btn--secondary pn-report__action">
        {tt.reports.allMine}
      </Link>
    </div>
  );
}
