"use client";

import { useCallback, useEffect, useState } from "react";
import { createDraft, fetchRevisions, publish, validate, type AdminResult } from "@/client/admin/api";
import type { RevisionList, RevisionRow, StoredValidationReport } from "@/domain/admin/schemas";
import { RULES } from "@/domain/admin/validation";
import { btnDanger, btnPrimary, btnSecondary, Chip, ErrorNote, Muted, OkNote, PageTitle, Panel, when } from "./parts";
import { AdminStepUp } from "./step-up";

// A12 Revisions & publication (N5a, C8, F-E11). Validate runs every rule and stores the report;
// Publish (a draft) and Roll back (to an earlier published revision) need a validation without
// errors on the current membership and a fresh step-up, and run in one database transaction.

type Mode = "publish" | "rollback";
type Pending = { id: string; label: string; mode: Mode };
type Notice = { ok: boolean; text: string } | null;

const STATUS: Record<RevisionRow["status"], string> = { draft: "Draft", validating: "Validating", published: "Published", superseded: "Superseded" };

const publishable = (r: RevisionRow) => r.validation?.ok === true && r.validation.current;

function validationText(r: RevisionRow): string {
  const v = r.validation;
  if (!v) return "Not validated";
  if (!v.current) return "Changed since validation";
  return v.ok ? `Passed ${when(v.validatedAt)} (${v.warningCount} warnings)` : `${v.errorCount} errors, ${v.warningCount} warnings`;
}

export function RevisionsScreen() {
  const [list, setList] = useState<AdminResult<RevisionList> | null>(null);
  const [report, setReport] = useState<StoredValidationReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [stepUp, setStepUp] = useState(false);

  const load = useCallback(async () => setList(await fetchRevisions()), []);
  useEffect(() => {
    let live = true;
    void fetchRevisions().then((r) => live && setList(r));
    return () => {
      live = false;
    };
  }, []);

  const data = list?.ok ? list.data : null;
  const published = data?.revisions.find((r) => r.isPublished) ?? null;
  const openDraft = data?.revisions.some((r) => r.status === "draft" || r.status === "validating") ?? false;

  const onCreate = async () => {
    setBusy("create");
    setNotice(null);
    const r = await createDraft();
    setBusy(null);
    setNotice(r.ok ? { ok: true, text: "Draft created from the published revision." } : { ok: false, text: r.message });
    await load();
  };

  const onValidate = async (row: RevisionRow) => {
    setBusy(`validate:${row.id}`);
    setNotice(null);
    setPending(null);
    const r = await validate(row.id);
    setBusy(null);
    if (r.ok) setReport(r.data);
    else setNotice({ ok: false, text: r.message });
    await load();
  };

  const run = async (p: Pending) => {
    setBusy(`${p.mode}:${p.id}`);
    setNotice(null);
    const r = await publish(p.id, p.mode, data?.publishedId ?? null);
    setBusy(null);
    if (!r.ok && r.code === "step_up_required") {
      setStepUp(true);
      return;
    }
    setStepUp(false);
    setPending(null);
    if (r.ok) {
      setReport(null);
      setNotice({
        ok: true,
        text: `${p.mode === "publish" ? "Published" : "Rolled back to"} ${p.label}. The public head now names it; riders' phones load it on their next check (within about 30 seconds).`,
      });
    } else {
      setNotice({ ok: false, text: r.message });
    }
    await load();
  };

  return (
    <div data-testid="admin-revisions">
      <PageTitle
        lead="A revision is a complete snapshot of the network. Validate it, then publish it; rolling back re-publishes an earlier one. Nothing is edited in place."
        actions={
          <>
            {openDraft ? <Muted>A draft is open; publish it before starting another.</Muted> : null}
            <button type="button" className={btnPrimary} disabled={!published || openDraft || busy !== null} onClick={() => void onCreate()} data-testid="create-draft">
              {busy === "create" ? "Creating…" : "New draft from published"}
            </button>
          </>
        }
      >
        Revisions and publication
      </PageTitle>

      {notice ? <div className="mb-4">{notice.ok ? <OkNote testId="admin-notice">{notice.text}</OkNote> : <ErrorNote testId="admin-notice">{notice.text}</ErrorNote>}</div> : null}

      {list === null ? (
        <Muted>Loading…</Muted>
      ) : !list.ok ? (
        <ErrorNote testId="revisions-error">{list.message}</ErrorNote>
      ) : (
        <div tabIndex={0} className="adm-scroll rounded-xl border border-ink-3/25 bg-white dark:border-navy-raised dark:bg-navy">
          <table className="w-full text-left text-sm" data-testid="revisions-table">
            <caption className="sr-only">Revisions, newest first</caption>
            <thead className="border-b border-fill dark:border-navy-raised">
              <tr>
                {["#", "Label", "Kind", "Status", "Members", "Created", "Published", "Last validation", "Actions"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data.revisions.map((r) => (
                <tr key={r.id} className="border-b border-fill last:border-0 dark:border-navy-raised" data-testid={`revision-${r.label}`}>
                  <td className="px-3 py-2 tabular-nums">{r.seq}</td>
                  <th scope="row" className="px-3 py-2 font-medium">
                    {r.label}
                    {r.isSynthetic ? <span className="ml-2 text-xs text-coral-ink dark:text-coral-bright">test data</span> : null}
                  </th>
                  <td className="px-3 py-2">{r.kind === "provisional" ? "Provisional" : "Verified"}</td>
                  <td className="px-3 py-2">
                    <Chip tone={r.isPublished ? "ok" : r.status === "superseded" ? "plain" : "info"}>{r.isPublished ? "Published (live)" : STATUS[r.status]}</Chip>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{r.memberCount}</td>
                  <td className="px-3 py-2">{when(r.createdAt)}</td>
                  <td className="px-3 py-2">{when(r.publishedAt)}</td>
                  <td className="px-3 py-2">{r.isPublished ? "–" : validationText(r)}</td>
                  <td className="px-3 py-2">
                    {r.isPublished ? (
                      <Muted>Live</Muted>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={btnSecondary} disabled={busy !== null} onClick={() => void onValidate(r)} data-testid={`validate-${r.label}`}>
                          {busy === `validate:${r.id}` ? "Validating…" : "Validate"}
                        </button>
                        {r.status === "draft" || r.status === "validating" ? (
                          <button
                            type="button"
                            className={btnPrimary}
                            disabled={busy !== null || !publishable(r)}
                            onClick={() => setPending({ id: r.id, label: r.label, mode: "publish" })}
                            data-testid={`publish-${r.label}`}
                          >
                            Publish…
                          </button>
                        ) : r.status === "superseded" ? (
                          <button
                            type="button"
                            className={btnDanger}
                            disabled={busy !== null || !publishable(r)}
                            onClick={() => setPending({ id: r.id, label: r.label, mode: "rollback" })}
                            data-testid={`rollback-${r.label}`}
                          >
                            Roll back to this…
                          </button>
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pending ? (
        <div className="mt-4" data-testid="confirm-publication">
          <Panel title={pending.mode === "publish" ? `Publish ${pending.label}?` : `Roll back to ${pending.label}?`}>
            <Muted>
              {`It replaces ${published?.label ?? "the published revision"} for every rider, at once. Saved trips on phones are checked against it the next time they open.`}
            </Muted>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className={pending.mode === "publish" ? btnPrimary : btnDanger}
                disabled={busy !== null || stepUp}
                onClick={() => void run(pending)}
                data-testid="confirm-publication-go"
              >
                {busy ? "Working…" : pending.mode === "publish" ? "Publish now" : "Roll back now"}
              </button>
              <button
                type="button"
                className={btnSecondary}
                disabled={busy !== null}
                onClick={() => {
                  setPending(null);
                  setStepUp(false);
                }}
              >
                Cancel
              </button>
            </div>
            {stepUp ? (
              <AdminStepUp
                action={pending.mode === "publish" ? "publish" : "roll back"}
                onVerified={() => void run(pending)}
                onCancel={() => setStepUp(false)}
              />
            ) : null}
          </Panel>
        </div>
      ) : null}

      {report ? <Report report={report} /> : null}
    </div>
  );
}

function Report({ report }: { report: StoredValidationReport }) {
  return (
    <div className="mt-6" data-testid="validation-report">
      <Panel title={`Validation of ${report.label}`}>
        <div className="mb-3">
          {report.ok ? (
            <OkNote testId="validation-ok">
              No errors{report.warningCount ? `, ${report.warningCount} warnings` : ""}. It can be published for the next 30 minutes, unless it changes.
            </OkNote>
          ) : (
            <ErrorNote testId="validation-errors">
              {report.errorCount} errors and {report.warningCount} warnings. Publishing stays blocked until the errors are fixed.
            </ErrorNote>
          )}
        </div>
        {report.issues.length > 0 ? (
          <table className="mb-4 w-full text-left text-sm" data-testid="validation-issues">
            <caption className="sr-only">Issues found</caption>
            <thead>
              <tr>
                {["Severity", "Rule", "Item", "Detail"].map((h) => (
                  <th key={h} scope="col" className="py-1 pr-3 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.issues.map((i, n) => (
                <tr key={`${i.rule}-${n}`} className="border-t border-fill dark:border-navy-raised">
                  <td className={`py-1 pr-3 font-medium ${i.severity === "error" ? "text-coral-ink dark:text-coral-bright" : ""}`}>{i.severity === "error" ? "Error" : "Warning"}</td>
                  <td className="py-1 pr-3">{RULES[i.rule].title}</td>
                  <td className="py-1 pr-3">{i.ref}</td>
                  <td className="py-1 pr-3">{i.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <h3 className="mb-1 text-sm font-semibold">Rules checked</h3>
        <ul className="mb-4 grid gap-0.5 text-sm" data-testid="validation-rules">
          {report.rules.map((r) => (
            <li key={r.id}>
              {r.title} ({r.severity}): {r.count === 0 ? "none found" : `${r.count} found`}
            </li>
          ))}
        </ul>
        <h3 className="mb-1 text-sm font-semibold">Not checked yet</h3>
        <ul className="grid gap-0.5 text-sm" data-testid="validation-deferred">
          {report.deferred.map((d) => (
            <li key={d.id}>
              {d.title}: {d.reason}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
