"use client";

import { useEffect, useState } from "react";
import { fetchProviders, runJevDiagnostic, type AdminResult } from "@/client/admin/api";
import { diagnosticBlocker, type DiagnosticResult, type Providers } from "@/domain/admin/system";
import { label } from "@/domain/admin/stops";
import { btnPrimary, Chip, ErrorNote, Muted, OkNote, PageTitle, Panel, when } from "./parts";

// A19 Jev & providers (N7, C12). What is configured, as yes/no: never a key, a secret or an error
// body. Moderators and admins read it; admins can run one synthetic Decisions call (only when the
// key is set and Jev is on), which counts against the daily budget and is audited.

const yesNo = (v: boolean) => <Chip tone={v ? "ok" : "warn"}>{v ? "Yes" : "No"}</Chip>;

export function ProvidersScreen() {
  const [state, setState] = useState<AdminResult<Providers> | null>(null);
  const [diag, setDiag] = useState<AdminResult<DiagnosticResult> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchProviders().then((r) => live && setState(r));
    return () => {
      live = false;
    };
  }, []);

  const run = async () => {
    setBusy(true);
    setDiag(null);
    const r = await runJevDiagnostic();
    setBusy(false);
    setDiag(r);
    setState(await fetchProviders());
  };

  if (state === null) return <Muted>Loading…</Muted>;
  if (!state.ok) return <ErrorNote>{state.message}</ErrorNote>;
  const { jev, providers, flags, canRunDiagnostic } = state.data;
  const blocked = diagnosticBlocker(jev);

  return (
    <div data-testid="admin-providers">
      <PageTitle lead="Configuration as yes or no. Keys and secrets are never shown here; they live in the deployment's environment.">Jev and providers</PageTitle>
      <div className="grid gap-6">
        <Panel title="Jev (community moderation advice)" testId="providers-jev">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="font-medium">API key present</dt>
            <dd data-testid="jev-key-present">{yesNo(jev.keyPresent)}</dd>
            <dt className="font-medium">Calls Jev</dt>
            <dd data-testid="jev-enabled">
              {yesNo(jev.enabled)} {jev.whyDisabled ? <span className="ml-1">{jev.whyDisabled}</span> : null}
            </dd>
            <dt className="font-medium">Model</dt>
            <dd>
              <code>{jev.modelId}</code> {jev.modelPinned ? <Chip tone="ok">Dated build</Chip> : <Chip tone="error">Not a dated build (refused in production)</Chip>}
            </dd>
            <dt className="font-medium">Decisions endpoint</dt>
            <dd>{jev.decisionsHost}</dd>
            <dt className="font-medium">Policy version</dt>
            <dd>{jev.policyVersion}</dd>
            <dt className="font-medium">Timeout</dt>
            <dd>{(jev.timeoutMs / 1000).toFixed(0)} s</dd>
            <dt className="font-medium">Calls today (UTC)</dt>
            <dd data-testid="jev-usage">
              {jev.usedToday ?? 0} of {jev.dailyBudget}
            </dd>
            <dt className="font-medium">Auto-publish</dt>
            <dd>{yesNo(jev.autoPublish)} (every post is reviewed by a person while this is No)</dd>
            <dt className="font-medium">Driver reports to Jev</dt>
            <dd>{yesNo(jev.complaints)} (stays No until the privacy impact assessment)</dd>
            <dt className="font-medium">Health</dt>
            <dd data-testid="jev-health">
              {jev.health
                ? `Last success ${when(jev.health.lastOkAt)}; ${jev.health.consecutiveFailures} failures in a row${jev.health.lastErrorCode ? ` (last: ${label(jev.health.lastErrorCode)})` : ""}${jev.health.circuitOpenUntil ? `; paused until ${when(jev.health.circuitOpenUntil)}` : ""}`
                : "No call recorded yet."}
            </dd>
          </dl>

          <div className="mt-4 grid gap-2 border-t border-fill pt-4 dark:border-navy-raised">
            <h3 className="text-sm font-semibold">Diagnostic</h3>
            {!canRunDiagnostic ? (
              <Muted>Only admins run the diagnostic.</Muted>
            ) : blocked ? (
              <Muted>
                <span data-testid="jev-diagnostic-blocked">{blocked}</span>
              </Muted>
            ) : (
              <>
                <Muted>Sends one made-up sentence (no user text) to the Decisions API and shows only the outcome. It counts as one call against today&apos;s budget.</Muted>
                <div>
                  <button type="button" className={btnPrimary} disabled={busy} onClick={() => void run()} data-testid="jev-diagnostic-run">
                    {busy ? "Calling Jev…" : "Run the diagnostic"}
                  </button>
                </div>
              </>
            )}
            {diag ? (
              !diag.ok ? (
                <ErrorNote testId="jev-diagnostic-result">{diag.message}</ErrorNote>
              ) : diag.data.status === "ok" ? (
                <OkNote testId="jev-diagnostic-result">
                  Jev answered in {diag.data.ms} ms: {label(diag.data.recommendation ?? "")} at {Math.round((diag.data.confidence ?? 0) * 100)}%.
                </OkNote>
              ) : diag.data.status === "skipped" ? (
                <Muted>{diag.data.reason}</Muted>
              ) : (
                <ErrorNote testId="jev-diagnostic-result">Jev did not answer: {label(diag.data.reason ?? "unknown")}. Posts stay pending for a person.</ErrorNote>
              )
            ) : null}
          </div>
        </Panel>

        <Panel title="Other providers" testId="providers-list">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Providers and whether they are configured</caption>
            <thead>
              <tr>
                {["Provider", "Configured", "On", "Notes"].map((h) => (
                  <th key={h} scope="col" className="py-1 pr-3 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id} className="border-t border-fill dark:border-navy-raised" data-testid={`provider-${p.id}`}>
                  <th scope="row" className="py-1 pr-3 font-medium">
                    {p.label}
                  </th>
                  <td className="py-1 pr-3">{yesNo(p.configured)}</td>
                  <td className="py-1 pr-3">{yesNo(p.enabled)}</td>
                  <td className="py-1 pr-3">{p.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Feature flags (database)" testId="providers-flags">
          <ul className="grid gap-1 text-sm">
            {flags.map((f) => (
              <li key={f.key}>
                <code>{f.key}</code>: {yesNo(f.enabled)} {f.updatedAt ? <span className="text-xs">(changed {when(f.updatedAt)})</span> : null}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
