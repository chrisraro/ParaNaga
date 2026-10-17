"use client";

// The MyNaga handoff for one of the person's own driver reports (S20, F-D5, task B9). Steps:
//  1 Prepare: copy a plain-text summary built here in the browser; download the evidence files.
//  2 Open MyNaga: the verified links (rendered by the parent screen).
//  3 After you submit: the person's own note that they submitted it, with an optional reference.
//
// Evidence: ParaNaga has no redaction tooling yet, so the only copy is the original, served by the
// owner's 60 s signed link. Each download is gated behind an explicit acknowledgement that the
// file may show other people's faces and vehicle plates and may carry location details.
//
// Honesty: ParaNaga sends nothing to MyNaga or City Hall and cannot confirm anything was received.
// The "I submitted it" note is the person's own statement and is labelled self-reported.

import "@/ui/kit/styles";
import "@/ui/report/report.css";
import "@/ui/reports/reports.css";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useAuthSession } from "@/client/auth/use-auth-session";
import { loadComplaint, loadEvidenceUrl, saveMyNagaSelfReport } from "@/client/reports/api";
import { buildMyNagaSummary } from "@/domain/mynaga/summary";
import { MYNAGA_REFERENCE_MAX, type ComplaintDetail } from "@/domain/reports/schemas";

export const BYSTANDER_WARNING = {
  title: "Original files only",
  lines: [
    "ParaNaga cannot blur faces or plates yet, so the file you download is the original.",
    "It may show other people's faces and vehicle plates, and it may carry location details.",
    "Share it only where you choose to, and only what you are comfortable sharing.",
  ],
  acknowledge: "I understand the file may show other people and where it was taken.",
} as const;
export const SELF_REPORT_NOTE =
  "ParaNaga does not send anything to MyNaga or City Hall and cannot confirm your report was received. This note is your own: it is saved to your account, shown as self-reported, and never changes the status of your ParaNaga report.";

type CopyState = "idle" | "copied" | "manual";

/** Clipboard API first; a selected read-only text area and execCommand as the fallback. */
export async function copyText(text: string, area: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or not a secure context: use the fallback.
  }
  if (!area) return false;
  try {
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

function startDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  // A new tab: the file lives on another origin, where the download attribute is ignored, so
  // opening it here would take the person out of the app.
  a.rel = "noopener noreferrer";
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function PrepareStep({ c }: { c: ComplaintDetail }) {
  const uid = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [copy, setCopy] = useState<CopyState>("idle");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const summary = buildMyNagaSummary(c);

  const onCopy = async () => {
    const ok = await copyText(summary, area.current);
    setCopy(ok ? "copied" : "manual");
    if (!ok) {
      area.current?.focus();
      area.current?.select();
    }
  };

  const onDownload = async (evidenceId: string, n: number) => {
    setBusy(evidenceId);
    setNote("");
    const r = await loadEvidenceUrl(c.id, evidenceId);
    setBusy(null);
    if (!r.ok) {
      setNote(r.reason === "rate_limited" ? r.message : `File ${n} could not be prepared. Try again.`);
      return;
    }
    startDownload(r.data);
    setNote(`File ${n} is downloading. The link worked for 60 seconds only.`);
  };

  return (
    <div className="pn-reports__panel" data-testid="handoff-prepare">
      <label htmlFor={`${uid}-summary`} className="pn-report__label">
        Summary to paste into MyNaga
      </label>
      <textarea id={`${uid}-summary`} ref={area} className="pn-reports__summary" readOnly value={summary} data-testid="handoff-summary" />
      <div className="pn-reports__actions">
        <button type="button" className="pn-btn pn-btn--primary" onClick={() => void onCopy()} data-testid="handoff-copy">
          Copy summary
        </button>
      </div>
      <p className="pn-reports__note" role="status" data-testid="handoff-copy-status">
        {copy === "copied" ? "Summary copied. Paste it into MyNaga." : copy === "manual" ? "Copying is not available here. The text is selected: copy it from the box above." : ""}
      </p>

      {c.evidence.length > 0 ? (
        <section className="pn-reports__actions" aria-labelledby={`${uid}-ev`} data-testid="handoff-evidence">
          <h3 id={`${uid}-ev`}>Your photos and videos</h3>
          <div className="pn-reports__warn" data-testid="handoff-bystander">
            <p>
              <strong>{BYSTANDER_WARNING.title}.</strong>
            </p>
            {BYSTANDER_WARNING.lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
          <label className="pn-report__check">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="handoff-ack" />
            <span>{BYSTANDER_WARNING.acknowledge}</span>
          </label>
          {c.evidence.map((e, i) => (
            <button
              key={e.id}
              type="button"
              className="pn-btn pn-btn--secondary"
              disabled={!ack || busy !== null}
              onClick={() => void onDownload(e.id, i + 1)}
              data-testid={`handoff-download-${i + 1}`}
            >
              {busy === e.id ? "Preparing…" : `Download file ${i + 1} (original)`}
            </button>
          ))}
          <p className="pn-reports__note" role="status" data-testid="handoff-download-status">
            {note}
          </p>
        </section>
      ) : null}
    </div>
  );
}

function SelfReport({ c }: { c: ComplaintDetail }) {
  const uid = useId();
  const [submitted, setSubmitted] = useState(c.handoff.submitted);
  const [reference, setReference] = useState(c.handoff.reference ?? "");
  const [saved, setSaved] = useState(c.handoff);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const onSave = async () => {
    setBusy(true);
    setMessage("");
    setError("");
    const ref = reference.trim();
    const r = await saveMyNagaSelfReport(c.id, submitted ? { submitted: true, ...(ref ? { reference: ref } : {}) } : { submitted: false });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setSaved(r.data);
    setSubmitted(r.data.submitted);
    setReference(r.data.reference ?? "");
    setMessage(r.data.submitted ? "Saved: submitted in MyNaga (self-reported)." : "Saved: not marked as submitted.");
  };

  return (
    <div className="pn-reports__panel" data-testid="handoff-selfreport">
      <p className="pn-reports__note" data-testid="handoff-selfreport-note">
        {SELF_REPORT_NOTE}
      </p>
      <label className="pn-report__check">
        <input type="checkbox" checked={submitted} onChange={(e) => setSubmitted(e.target.checked)} data-testid="handoff-submitted" />
        <span>I submitted it in MyNaga</span>
      </label>
      {submitted ? (
        <div className="pn-report__field">
          <label htmlFor={`${uid}-ref`} className="pn-report__label">
            MyNaga reference (optional)
          </label>
          <input
            id={`${uid}-ref`}
            className="pn-report__input"
            type="text"
            inputMode="text"
            autoComplete="off"
            maxLength={MYNAGA_REFERENCE_MAX}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            data-testid="handoff-reference"
          />
          <span className="pn-report__hint">Up to {MYNAGA_REFERENCE_MAX} characters, as MyNaga shows it. Plain text.</span>
        </div>
      ) : null}
      <div className="pn-reports__actions">
        <button type="button" className="pn-btn pn-btn--secondary" onClick={() => void onSave()} disabled={busy} data-testid="handoff-save">
          {busy ? "Saving…" : "Save my note"}
        </button>
      </div>
      <p className="pn-reports__note" role="status" data-testid="handoff-save-status">
        {message}
      </p>
      {error ? (
        <div className="pn-report__error" role="alert">
          {error}
        </div>
      ) : null}
      <p className="pn-reports__when" data-testid="handoff-saved-state">
        {saved.submitted ? `Saved as: submitted in MyNaga (self-reported)${saved.reference ? `, reference ${saved.reference}` : ""}.` : "Saved as: not marked as submitted."}
      </p>
    </div>
  );
}

type Load = { phase: "loading" } | { phase: "error"; message: string } | { phase: "ready"; data: ComplaintDetail };

/** Loads the report once; renders the prepare step, the links slot (children) and the self-report. */
export function ReportHandoff({ id, links }: { id: string; links: React.ReactNode }) {
  const { user, loading } = useAuthSession();
  const [state, setState] = useState<Load>({ phase: "loading" });
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let live = true;
    void loadComplaint(id).then((r) => {
      if (live) setState(r.ok ? { phase: "ready", data: r.data } : { phase: "error", message: r.message });
    });
    return () => {
      live = false;
    };
  }, [userId, id]);

  if (loading) return <p role="status">Loading…</p>;
  if (!user) {
    return (
      <div className="pn-report__signin" data-testid="handoff-signin">
        <p>Sign in to prepare a summary of your report.</p>
        <Link href="/app/sign-in" className="pn-btn pn-btn--primary pn-report__action">
          Sign in
        </Link>
      </div>
    );
  }
  if (state.phase === "loading") return <p role="status">Loading your report…</p>;
  if (state.phase === "error") {
    return (
      <div className="pn-report__error" role="alert" data-testid="handoff-error">
        {state.message}
      </div>
    );
  }
  const c = state.data;
  return (
    <>
      <section className="pn-mynaga__step" aria-labelledby="pn-mynaga-s1">
        <h2 id="pn-mynaga-s1" className="pn-mynaga__step-title">
          <span className="pn-mynaga__num" aria-hidden="true">
            1
          </span>
          Prepare what you will share
        </h2>
        <p className="pn-reports__when" data-testid="handoff-report-ref">
          Report {c.reference}
        </p>
        <PrepareStep c={c} />
      </section>
      {links}
      <section className="pn-mynaga__step" aria-labelledby="pn-mynaga-s3">
        <h2 id="pn-mynaga-s3" className="pn-mynaga__step-title">
          <span className="pn-mynaga__num" aria-hidden="true">
            3
          </span>
          Tell us if you submitted it
        </h2>
        <SelfReport c={c} />
      </section>
    </>
  );
}
