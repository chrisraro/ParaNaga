"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { fetchImports, importCommit, importDryRun, type AdminResult } from "@/client/admin/api";
import { IMPORT_MAX_CHARS, label, type ImportCommitResult, type ImportDryRun, type ImportFormat, type ImportList, type ImportUpload } from "@/domain/admin/stops";
import { btnPrimary, btnSecondary, Chip, ErrorNote, Field, inputCls, Muted, OkNote, PageTitle, Panel, when, Empty } from "./parts";

// A2 Imports (N5b, C2). Upload a My Maps export (KML, the raw authority, or the package CSV), run a
// dry run on the server (nothing is written: the diff against the newest committed batch, the
// counts check, the conflicts), then commit: a new batch in ingest.* and, in the open draft, new
// candidates for added pins and new versions for moved ones. Committing a file with nothing new
// writes nothing (a rerun is idempotent).

const formatOf = (name: string): ImportFormat => (name.toLowerCase().endsWith(".csv") ? "csv" : "kml");

export function ImportsScreen() {
  const [imports, setImports] = useState<AdminResult<ImportList> | null>(null);
  const [upload, setUpload] = useState<ImportUpload | null>(null);
  const [retrievedOn, setRetrievedOn] = useState("");
  const [format, setFormat] = useState<ImportFormat>("kml");
  const [fileError, setFileError] = useState<string | null>(null);
  const [dry, setDry] = useState<AdminResult<ImportDryRun> | null>(null);
  const [committed, setCommitted] = useState<AdminResult<ImportCommitResult> | null>(null);
  const [busy, setBusy] = useState<"dry" | "commit" | null>(null);

  const load = useCallback(async () => setImports(await fetchImports()), []);
  useEffect(() => {
    let live = true;
    void fetchImports().then((r) => live && setImports(r));
    return () => {
      live = false;
    };
  }, []);

  const onFile = async (file: File | undefined) => {
    setDry(null);
    setCommitted(null);
    setFileError(null);
    setUpload(null);
    if (!file) return;
    const text = await file.text();
    if (text.length > IMPORT_MAX_CHARS) {
      setFileError("The file is too large for an import (at most 1,000,000 characters).");
      return;
    }
    setFormat(formatOf(file.name));
    setUpload({ format: formatOf(file.name), fileName: file.name, text, retrievedOn: "" });
  };

  const current = upload ? { ...upload, format, retrievedOn } : null;

  const runDry = async (e: FormEvent) => {
    e.preventDefault();
    if (!current) return;
    setBusy("dry");
    setCommitted(null);
    setDry(await importDryRun(current));
    setBusy(null);
  };

  const runCommit = async () => {
    if (!current || !dry?.ok || !dry.data.baseline) return;
    setBusy("commit");
    const r = await importCommit(current, dry.data.baseline.batchId);
    setBusy(null);
    setCommitted(r);
    if (r.ok) setDry(null);
    await load();
  };

  const baseline = imports?.ok ? imports.data.baseline : null;
  return (
    <div data-testid="admin-imports">
      <PageTitle lead="Upload a My Maps export to see what changed since the last committed import. The dry run writes nothing; commit adds the changes to the open draft revision, where they wait for review and publication.">
        Imports
      </PageTitle>

      <div className="grid gap-6">
        <Panel title="Upload" testId="import-upload">
          {baseline ? (
            <p className="mb-3 text-sm" data-testid="import-baseline">
              Compared with <strong>{baseline.snapshotVersion}</strong>, committed {when(baseline.finishedAt)}.
            </p>
          ) : imports?.ok ? (
            <Muted>No My Maps import is committed yet; the first import runs from the command line (pnpm db:import --commit).</Muted>
          ) : null}
          <form className="grid gap-3 md:grid-cols-3" onSubmit={(e) => void runDry(e)}>
            <Field label="File (KML or CSV)">
              <input
                className={inputCls}
                type="file"
                accept=".kml,.csv,application/vnd.google-earth.kml+xml,text/csv"
                onChange={(e) => void onFile(e.target.files?.[0])}
                data-testid="import-file"
              />
            </Field>
            <Field label="Format">
              <select className={inputCls} value={format} onChange={(e) => setFormat(e.target.value as ImportFormat)} data-testid="import-format">
                <option value="kml">KML (My Maps export)</option>
                <option value="csv">CSV (research package)</option>
              </select>
            </Field>
            <Field label="Export date" hint="The day the file was downloaded from My Maps.">
              <input className={inputCls} type="date" required value={retrievedOn} onChange={(e) => setRetrievedOn(e.target.value)} data-testid="import-date" />
            </Field>
            <div className="md:col-span-3 flex items-center gap-3">
              <button type="submit" className={btnSecondary} disabled={!current || !retrievedOn || busy !== null} data-testid="import-dry-run">
                {busy === "dry" ? "Checking…" : "Run dry run"}
              </button>
              {current ? <Muted>{`${current.fileName}, ${current.text.length.toLocaleString("en-PH")} characters`}</Muted> : null}
            </div>
          </form>
          {fileError ? <div className="mt-3"><ErrorNote>{fileError}</ErrorNote></div> : null}
        </Panel>

        {dry && !dry.ok ? <ErrorNote testId="import-error">{dry.message}</ErrorNote> : null}
        {dry?.ok ? <DryRun dry={dry.data} busy={busy === "commit"} onCommit={() => void runCommit()} /> : null}
        {committed ? <CommitOutcome result={committed} /> : null}

        <Panel title="Import history" testId="import-history">
          {imports === null ? (
            <Muted>Loading…</Muted>
          ) : !imports.ok ? (
            <ErrorNote>{imports.message}</ErrorNote>
          ) : imports.data.batches.length === 0 ? (
            <Empty title="No batches yet.">Run a dry run from the command line first; its result is listed here.</Empty>
          ) : (
            <table className="w-full text-left text-sm" data-testid="import-batches">
              <caption className="sr-only">Import batches, newest first</caption>
              <thead>
                <tr>
                  {["Snapshot", "Status", "File", "Added", "Changed", "Unchanged", "Missing", "Conflicts", "Finished"].map((h) => (
                    <th key={h} scope="col" className="py-1 pr-3 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {imports.data.batches.map((b) => (
                  <tr key={b.id} className="border-t border-fill dark:border-navy-raised">
                    <th scope="row" className="py-1 pr-3 font-medium">{b.snapshotVersion}</th>
                    <td className="py-1 pr-3">{b.status}</td>
                    <td className="py-1 pr-3">{b.fileName ?? "–"}</td>
                    <td className="py-1 pr-3 tabular-nums">{b.changes.added}</td>
                    <td className="py-1 pr-3 tabular-nums">{b.changes.changed}</td>
                    <td className="py-1 pr-3 tabular-nums">{b.changes.unchanged}</td>
                    <td className="py-1 pr-3 tabular-nums">{b.changes.missing}</td>
                    <td className="py-1 pr-3 tabular-nums">{b.conflicts}</td>
                    <td className="py-1 pr-3">{when(b.finishedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}

function DryRun({ dry, busy, onCommit }: { dry: ImportDryRun; busy: boolean; onCommit: () => void }) {
  const { changes } = dry;
  const nothing = changes.added + changes.changed + changes.missing === 0;
  return (
    <Panel title="Dry run" testId="import-dry">
      <p className="mb-3 text-sm">
        {dry.snapshotVersion ?? "No snapshot"} · sha256 <span className="font-mono text-xs break-all">{dry.sha256}</span>
      </p>
      <ul className="mb-3 flex flex-wrap gap-2 text-sm" data-testid="import-changes">
        <li><Chip>{changes.added} added</Chip></li>
        <li><Chip>{changes.changed} changed</Chip></li>
        <li><Chip tone="ok">{changes.unchanged} unchanged</Chip></li>
        <li><Chip tone={changes.missing ? "warn" : "plain"}>{changes.missing} missing</Chip></li>
      </ul>

      <h3 className="mb-1 text-sm font-semibold">Counts check</h3>
      <table className="mb-4 text-left text-sm" data-testid="import-counts">
        <caption className="sr-only">Pins per layer against the expected counts</caption>
        <thead>
          <tr>
            {["Layer", "In the file", "Expected"].map((h) => (
              <th key={h} scope="col" className="py-1 pr-6 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(dry.counts.expectedByLayer).map(([layer, expected]) => (
            <tr key={layer} className="border-t border-fill dark:border-navy-raised">
              <th scope="row" className="py-1 pr-6 font-medium">{layer}</th>
              <td className="py-1 pr-6 tabular-nums">{dry.counts.byLayer[layer] ?? 0}</td>
              <td className="py-1 pr-6 tabular-nums">{expected}</td>
            </tr>
          ))}
          <tr className="border-t border-fill dark:border-navy-raised">
            <th scope="row" className="py-1 pr-6 font-medium">Total</th>
            <td className="py-1 pr-6 tabular-nums">{dry.counts.total}</td>
            <td className="py-1 pr-6 tabular-nums">{dry.counts.expectedTotal}</td>
          </tr>
        </tbody>
      </table>

      {dry.problems.length > 0 ? (
        <div className="mb-4" data-testid="import-problems">
          <ErrorNote>{`${dry.problems.length} problem${dry.problems.length === 1 ? "" : "s"}; commit is disabled until the file is fixed.`}</ErrorNote>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {dry.problems.slice(0, 30).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {dry.rows.length > 0 ? (
        <>
          <h3 className="mb-1 text-sm font-semibold">Differences</h3>
          <table className="mb-4 w-full text-left text-sm" data-testid="import-rows">
            <caption className="sr-only">Added, changed and missing pins</caption>
            <thead>
              <tr>
                {["Change", "Layer", "Code", "Label", "Was", "Moved"].map((h) => (
                  <th key={h} scope="col" className="py-1 pr-3 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dry.rows.map((r, i) => (
                <tr key={`${r.kind}-${r.layer}-${r.code}-${i}`} className="border-t border-fill dark:border-navy-raised">
                  <td className="py-1 pr-3">{r.kind}</td>
                  <td className="py-1 pr-3">{r.layer}</td>
                  <td className="py-1 pr-3">{r.code ?? "–"}</td>
                  <th scope="row" className="py-1 pr-3 font-medium">{r.label || "(no label)"}</th>
                  <td className="py-1 pr-3">{r.fromLabel ?? "–"}</td>
                  <td className="py-1 pr-3 tabular-nums">{r.movedM === null ? "–" : `${r.movedM} m`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <h3 className="mb-1 text-sm font-semibold">Conflicts ({dry.conflicts.length}, recorded for review, never resolved automatically)</h3>
      {dry.conflicts.length === 0 ? (
        <Muted>None.</Muted>
      ) : (
        <ul className="mb-4 grid max-h-64 gap-0.5 overflow-auto text-sm" data-testid="import-conflicts">
          {dry.conflicts.map((c, i) => (
            <li key={i}>
              <Chip>{label(c.kind)}</Chip>
              {c.meters !== null ? ` ${c.meters} m:` : ":"} {c.records.map((r) => `${r.layer}/${r.code} “${r.label}”`).join(" | ")}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button type="button" className={btnPrimary} disabled={!dry.canCommit || busy} onClick={onCommit} data-testid="import-commit">
          {busy ? "Committing…" : nothing ? "Commit (nothing will change)" : "Commit to the open draft"}
        </button>
        {!dry.canCommit ? <Muted>Fix the problems above to commit.</Muted> : null}
      </div>
    </Panel>
  );
}

function CommitOutcome({ result }: { result: AdminResult<ImportCommitResult> }) {
  if (!result.ok) return <ErrorNote testId="import-commit-result">{result.message}</ErrorNote>;
  const r = result.data;
  const n = (k: string) => Number(r.counts[k] ?? 0);
  return r.outcome === "unchanged" ? (
    <OkNote testId="import-commit-result">{`Nothing changed: ${n("unchanged")} pins unchanged since ${r.snapshotVersion}. Nothing was written.`}</OkNote>
  ) : (
    <OkNote testId="import-commit-result">
      {`Committed ${r.snapshotVersion}: ${n("added")} added, ${n("changed")} changed, ${n("unchanged")} unchanged, ${n("missing")} missing. ` +
        `${n("new_candidate_stops")} new candidates and ${n("new_stop_versions")} moved candidates are in the open draft; review them under Candidate review, then validate the draft.`}
    </OkNote>
  );
}
