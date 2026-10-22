"use client";

import { useEffect, useState } from "react";
import { fetchAudit, type AdminResult, type AuditFilters } from "@/client/admin/api";
import type { AuditPage } from "@/domain/admin/system";
import { btnPrimary, btnSecondary, ErrorNote, Field, inputCls, Muted, PageTitle, when } from "./parts";

// A21 Audit log (N7, C12). Read-only, newest first, 50 rows a page. Admins read every row and can
// filter by actor; other staff read their own actions only (the database decides, not this page).
// Rows never contain report text or personal data from driver reports.

type Filters = Omit<AuditFilters, "before">;

const compact = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v));

export function AuditScreen({ all }: { all: boolean }) {
  const [draft, setDraft] = useState<Filters>({});
  const [filters, setFilters] = useState<Filters>({});
  const [cursors, setCursors] = useState<string[]>([]);
  const [state, setState] = useState<AdminResult<AuditPage> | null>(null);

  const before = cursors.at(-1);
  useEffect(() => {
    let live = true;
    void fetchAudit({ ...filters, before }).then((r) => live && setState(r));
    return () => {
      live = false;
    };
  }, [filters, before]);

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    setState(null);
    setCursors([]);
    setFilters({ ...draft });
  };
  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  return (
    <div data-testid="admin-audit">
      <PageTitle lead={all ? "Every recorded action, newest first. Read-only." : "Your own recorded actions, newest first. Read-only; admins see everyone's."}>Audit log</PageTitle>

      <form className="mb-4 flex flex-wrap items-end gap-3" onSubmit={apply} aria-label="Filter the audit log" data-testid="audit-filters">
        {all ? (
          <div className="w-64">
            <Field label="Actor (user id)">
              <input className={inputCls} value={draft.actor ?? ""} onChange={set("actor")} data-testid="audit-actor" />
            </Field>
          </div>
        ) : null}
        <div className="w-56">
          <Field label="Action" hint="Exact, or a prefix ending in *, e.g. role.*">
            <input className={inputCls} value={draft.action ?? ""} onChange={set("action")} data-testid="audit-action" />
          </Field>
        </div>
        <div className="w-44">
          <Field label="From (Manila date)">
            <input className={inputCls} type="date" value={draft.from ?? ""} onChange={set("from")} data-testid="audit-from" />
          </Field>
        </div>
        <div className="w-44">
          <Field label="To (Manila date)">
            <input className={inputCls} type="date" value={draft.to ?? ""} onChange={set("to")} data-testid="audit-to" />
          </Field>
        </div>
        <button type="submit" className={btnPrimary} data-testid="audit-apply">
          Show
        </button>
      </form>

      {state === null ? (
        <Muted>Loading…</Muted>
      ) : !state.ok ? (
        <ErrorNote testId="audit-error">{state.message}</ErrorNote>
      ) : state.data.rows.length === 0 ? (
        <Muted>No recorded action matches.</Muted>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-fill bg-white dark:border-navy-raised dark:bg-navy">
          <table className="w-full text-left text-sm" data-testid="audit-table">
            <caption className="sr-only">Audit log rows, newest first</caption>
            <thead className="border-b border-fill dark:border-navy-raised">
              <tr>
                {["When", "Who", "Action", "Entity", "Details", "Request"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.data.rows.map((r) => (
                <tr key={r.id} className="border-b border-fill align-top last:border-0 dark:border-navy-raised">
                  <td className="whitespace-nowrap px-3 py-2">{when(r.at)}</td>
                  <td className="px-3 py-2">
                    {r.actorName ?? (r.actorUserId ? <code className="text-xs">{r.actorUserId}</code> : r.actorRole === "system" ? "System" : r.actorRole ?? "–")}
                  </td>
                  <td className="px-3 py-2">
                    <code>{r.action}</code>
                  </td>
                  <td className="px-3 py-2">
                    {r.entityType}
                    {r.entityId ? <code className="ml-1 break-all text-xs">{r.entityId}</code> : null}
                  </td>
                  <td className="max-w-xs break-all px-3 py-2 font-mono text-xs">{compact(r.after)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.requestId ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button type="button" className={btnSecondary} disabled={cursors.length === 0} onClick={() => setCursors((c) => c.slice(0, -1))} data-testid="audit-newer">
          Newer
        </button>
        <button
          type="button"
          className={btnSecondary}
          disabled={!state?.ok || !state.data.next}
          onClick={() => state?.ok && state.data.next && setCursors((c) => [...c, state.data.next!])}
          data-testid="audit-older"
        >
          Older
        </button>
      </div>
    </div>
  );
}
