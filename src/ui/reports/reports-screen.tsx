"use client";

// My reports (S19, task B9): the signed-in person's own corrections and driver reports, newest
// first, each with an honest status from its own lifecycle. A row shows the kind, the category,
// the PN reference (driver reports), the date and the status. Never what the person wrote: that
// is only on the detail screen. Guests are asked to sign in. Nothing is stored on the phone.

import "@/ui/kit/styles";
import "@/ui/report/report.css";
import "./reports.css";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthSession } from "@/client/auth/use-auth-session";
import { loadMyReports } from "@/client/reports/api";
import { manilaDay, type ReportRow } from "@/domain/reports/list";
import { ListCell, ListGroup } from "@/ui/kit/list";
import { Note } from "@/ui/kit/note";

export const REPORTS_INTRO = "Only you can see these. Status shows where each report stands in ParaNaga.";

export function StatusChip({ tone, children }: { tone: ReportRow["tone"]; children: string }) {
  return <span className={tone === "open" || tone === "closed" ? "pn-rchip" : `pn-rchip pn-rchip--${tone}`}>{children}</span>;
}

type State = { phase: "loading" } | { phase: "ready"; rows: ReportRow[] } | { phase: "error"; message: string };

export function ReportsScreen() {
  const { user, loading } = useAuthSession();
  const [state, setState] = useState<State>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void loadMyReports().then((r) => {
      if (live) setState(r.ok ? { phase: "ready", rows: r.data } : { phase: "error", message: r.message });
    });
    return () => {
      live = false;
    };
  }, [userId, attempt]);

  if (loading) {
    return (
      <p className="pn-reports__intro" role="status">
        Loading…
      </p>
    );
  }
  if (!user) {
    return (
      <div className="pn-reports" data-testid="reports-guest">
        <div className="pn-report__signin" data-testid="reports-signin">
          <p>Sign in to see the reports you sent. Reports are linked to your account so only you can see them.</p>
          <Link href="/app/sign-in" className="pn-btn pn-btn--primary pn-report__action">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pn-reports" data-testid="reports-list-screen">
      <p className="pn-reports__intro">{REPORTS_INTRO}</p>
      {state.phase === "loading" ? (
        <p className="pn-reports__intro" role="status">
          Loading your reports…
        </p>
      ) : null}
      {state.phase === "error" ? (
        <div className="pn-report__error" role="alert" data-testid="reports-error">
          {state.message}
          <button
            type="button"
            className="pn-btn pn-btn--secondary pn-report__action"
            onClick={() => {
              setState({ phase: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : null}
      {state.phase === "ready" && state.rows.length === 0 ? (
        <Note testId="reports-empty">You have not sent any reports yet.</Note>
      ) : null}
      {state.phase === "ready" && state.rows.length > 0 ? (
        <ListGroup label="Your reports" testId="reports-list">
          {state.rows.map((r) => (
            <ListCell
              key={`${r.kind}-${r.id}`}
              href={r.href}
              testId={`report-row-${r.kind}`}
              title={`${r.kindLabel}: ${r.categoryLabel}`}
              sub={
                <>
                  {r.reference ? <span data-testid="report-row-ref">{r.reference}</span> : null}
                  {r.reference ? " · " : ""}
                  {manilaDay(r.at)}
                </>
              }
              badges={<StatusChip tone={r.tone}>{r.statusLabel}</StatusChip>}
            />
          ))}
        </ListGroup>
      ) : null}
      <div className="pn-reports__actions">
        <Link href="/app/report-driver" className="pn-btn pn-btn--secondary pn-report__action">
          Report a driver
        </Link>
      </div>
    </div>
  );
}
