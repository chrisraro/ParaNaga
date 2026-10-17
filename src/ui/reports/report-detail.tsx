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
import { statusLabel } from "@/domain/corrections/status";
import { complaintTone, correctionTone, manilaDate, outcomeLabel } from "@/domain/reports/list";
import type { ComplaintDetail, CorrectionDetail } from "@/domain/reports/schemas";
import { StatusChip } from "./reports-screen";

export const MYNAGA_PANEL_NOTE =
  "ParaNaga does not send anything to MyNaga or City Hall and cannot confirm that your report was received. This is only what you told us.";

type Timeline = { status: string; at: string; note?: string | null }[];

function TimelineList({ events, label }: { events: Timeline; label: (status: string) => string }) {
  return (
    <ol className="pn-reports__timeline" data-testid="report-timeline">
      {events.map((e, i) => (
        <li key={`${e.status}-${e.at}-${i}`}>
          <span className="pn-reports__event">{label(e.status)}</span>
          <span className="pn-reports__when">{manilaDate(e.at)}</span>
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
  const outcome = outcomeLabel(c.outcomeCode);
  return (
    <>
      <div className="pn-reports__panel">
        <h2 data-testid="report-ref">{c.reference}</h2>
        <StatusChip tone={complaintTone(c.status)}>{complaintStatusLabel(c.status)}</StatusChip>
        {outcome ? <p className="pn-reports__note">{outcome}.</p> : null}
        <h3>Status in ParaNaga</h3>
        <TimelineList events={c.events} label={(s) => complaintStatusLabel(s as ComplaintDetail["status"])} />
      </div>

      <div className="pn-reports__panel" data-testid="report-content">
        <h3>What you reported</h3>
        <dl className="pn-reports__kv">
          <Fact name="Category">{complaintCategoryLabel(c.category)}</Fact>
          <Fact name="When it happened">{manilaDate(c.incidentAt)}</Fact>
          {c.locationText ? <Fact name="Where">{c.locationText}</Fact> : null}
          {c.operator ? <Fact name="Operator">{c.operator}</Fact> : null}
          {c.plate ? <Fact name="Plate number">{c.plate}</Fact> : null}
          {c.bodyNumber ? <Fact name="Body number">{c.bodyNumber}</Fact> : null}
          <Fact name="What happened">{c.description}</Fact>
          <Fact name="Photos and videos">{c.evidence.length === 0 ? "None" : String(c.evidence.length)}</Fact>
        </dl>
      </div>

      <section className="pn-reports__panel" aria-labelledby="pn-report-mynaga" data-testid="report-mynaga-panel">
        <h3 id="pn-report-mynaga">MyNaga (self-reported)</h3>
        <p className="pn-reports__intro" data-testid="report-mynaga-state">
          {c.handoff.submitted
            ? `You said you submitted this in MyNaga${c.handoff.submittedAt ? ` on ${manilaDate(c.handoff.submittedAt)}` : ""}.`
            : "You have not said you submitted this in MyNaga."}
          {c.handoff.reference ? ` Your reference: ${c.handoff.reference}.` : ""}
        </p>
        <p className="pn-reports__note">{MYNAGA_PANEL_NOTE}</p>
        <Link href={`/app/mynaga?report=${c.id}`} className="pn-btn pn-btn--primary pn-report__action" data-testid="report-mynaga-link">
          {c.handoff.submitted ? "Open the MyNaga steps" : "Continue in MyNaga"}
        </Link>
      </section>
    </>
  );
}

function CorrectionView({ c }: { c: CorrectionDetail }) {
  return (
    <>
      <div className="pn-reports__panel">
        <h2>{categoryLabel(c.category)}</h2>
        <StatusChip tone={correctionTone(c.status)}>{statusLabel(c.status)}</StatusChip>
        <h3>Status in ParaNaga</h3>
        <TimelineList events={c.events} label={(s) => statusLabel(s as CorrectionDetail["status"])} />
      </div>
      <div className="pn-reports__panel" data-testid="report-content">
        <h3>What you reported</h3>
        <dl className="pn-reports__kv">
          {c.entityLabel ? <Fact name="About">{c.entityLabel}</Fact> : null}
          <Fact name="Details">{c.description}</Fact>
        </dl>
      </div>
    </>
  );
}

type View = { phase: "loading" } | { phase: "error"; message: string } | { phase: "complaint"; data: ComplaintDetail } | { phase: "correction"; data: CorrectionDetail };

export function ReportDetailScreen({ kind, id }: { kind: "complaint" | "correction"; id: string }) {
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
        Loading…
      </p>
    );
  }
  if (!user) {
    return (
      <div className="pn-report__signin" data-testid="reports-signin">
        <p>Sign in to see this report.</p>
        <Link href="/app/sign-in" className="pn-btn pn-btn--primary pn-report__action">
          Sign in
        </Link>
      </div>
    );
  }
  return (
    <div className="pn-reports" data-testid="report-detail">
      {view.phase === "loading" ? (
        <p className="pn-reports__intro" role="status">
          Loading…
        </p>
      ) : null}
      {view.phase === "error" ? (
        <div className="pn-report__error" role="alert">
          {view.message}
        </div>
      ) : null}
      {view.phase === "complaint" ? <ComplaintView c={view.data} /> : null}
      {view.phase === "correction" ? <CorrectionView c={view.data} /> : null}
      <Link href="/app/reports" className="pn-btn pn-btn--secondary pn-report__action">
        All my reports
      </Link>
    </div>
  );
}
