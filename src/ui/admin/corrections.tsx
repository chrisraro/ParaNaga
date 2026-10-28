"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchCorrections, reviewCorrection, reviewMediaSrc, type AdminResult } from "@/client/admin/api";
import {
  ACTION_LABELS,
  pesos,
  REASON_LABELS,
  reviewActions,
  type AcceptChange,
  type CorrectionItem,
  type CorrectionQueue,
  type CorrectionScope,
  type ReviewAction,
  type ReviewPayload,
} from "@/domain/admin/corrections";
import { label } from "@/domain/admin/stops";
import { INFO_REASONS, REJECT_REASONS } from "@/domain/corrections/review-reasons";
import { en } from "@/i18n/dict";
import { btnPrimary, btnSecondary, Chip, ErrorNote, Field, inputCls, Muted, OkNote, PageTitle, Panel, when, Empty } from "./parts";

// A14 Corrections review (N6, C9). Commuter reports with their evidence; a transport reviewer
// starts the review, asks for information, rejects, marks a duplicate or accepts. Accepting puts
// the change into the open DRAFT only (a stop action made here, a stop version already edited in
// the draft, or a recorded proposal); nothing public changes until the draft is validated and
// published under Revisions & publication (AC-13). Reviewers never see their own reports.

const category = (c: CorrectionItem) => en.report.categories[c.kind]?.label ?? label(c.kind);
const entity = (c: CorrectionItem) => `${en.report.entity[c.entityType]}: ${c.entityLabel ?? c.entityId}`;
const tone = (s: string) => (s === "needs_evidence" ? "warn" : s === "accepted" || s === "incorporated" ? "ok" : "plain");

export function CorrectionsScreen() {
  const [scope, setScope] = useState<CorrectionScope>("open");
  const [state, setState] = useState<AdminResult<CorrectionQueue> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (s: CorrectionScope) => setState(await fetchCorrections(s)), []);
  useEffect(() => {
    let live = true;
    void fetchCorrections(scope).then((r) => live && setState(r));
    return () => {
      live = false;
    };
  }, [scope]);

  const data = state?.ok ? state.data : null;

  const act = async (c: CorrectionItem, payload: ReviewPayload) => {
    const r = await reviewCorrection(c.id, payload);
    setNotice(
      r.ok
        ? {
            ok: true,
            text:
              r.data.status === "accepted"
                ? `Accepted into the draft${r.data.draftChange?.kind === "proposal" ? " as a proposal" : ""}. Nothing is public until the draft is validated and published.`
                : `Moved to ${label(r.data.status)}.`,
          }
        : { ok: false, text: r.message },
    );
    if (r.ok) setOpen(null);
    await load(scope);
  };

  return (
    <div data-testid="admin-corrections">
      <PageTitle lead="Reports from commuters, with their evidence. Accepting puts the change into the open draft only; nothing public changes until that draft is validated and published. Your own reports are never shown to you.">
        Corrections review
      </PageTitle>
      <div className="mb-4 flex gap-2" role="group" aria-label="Which reports">
        {(["open", "closed"] as const).map((s) => (
          <button key={s} type="button" className={btnSecondary} aria-pressed={scope === s} onClick={() => setScope(s)} data-testid={`scope-${s}`}>
            {s === "open" ? "Open" : "Closed"}
          </button>
        ))}
      </div>
      {notice ? <div className="mb-4">{notice.ok ? <OkNote testId="correction-notice">{notice.text}</OkNote> : <ErrorNote testId="correction-notice">{notice.text}</ErrorNote>}</div> : null}
      {state === null ? (
        <Muted>Loading…</Muted>
      ) : !state.ok ? (
        <ErrorNote>{state.message}</ErrorNote>
      ) : (
        <div className="grid gap-4">
          <Muted>{data?.draft ? `Accepted changes go into the open draft ${data.draft.label}.` : "No draft is open: accepting a report needs one (Revisions & publication)."}</Muted>
          <Panel title={`${scope === "open" ? "Open" : "Closed"} reports (${data?.corrections.length ?? 0})`} testId="corrections">
            {data?.corrections.length === 0 ? (
              <Empty title="Nothing here.">No reports match this filter. Switch the filter above to see other reports.</Empty>
            ) : (
              <table className="w-full text-left text-sm" data-testid="corrections-table">
                <caption className="sr-only">Correction reports</caption>
                <thead>
                  <tr>
                    {["Report", "About", "Status", "Sent", "Evidence", ""].map((h, i) => (
                      <th key={h || i} scope="col" className="py-1 pr-3 font-semibold">
                        {h || <span className="sr-only">Open</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data!.corrections.map((c) => (
                    <Row key={c.id} c={c} open={open === c.id} draftOpen={Boolean(data!.draft)} onOpen={() => setOpen(open === c.id ? null : c.id)} onAct={act} />
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

function Row({ c, open, draftOpen, onOpen, onAct }: { c: CorrectionItem; open: boolean; draftOpen: boolean; onOpen: () => void; onAct: (c: CorrectionItem, p: ReviewPayload) => Promise<void> }) {
  const evidence = [c.media.length ? `${c.media.length} photo${c.media.length === 1 ? "" : "s"}` : null, c.location ? "location" : null].filter(Boolean).join(", ") || "text only";
  return (
    <>
      <tr className="border-t border-fill dark:border-navy-raised" data-testid={`correction-${c.id}`}>
        <th scope="row" className="py-1 pr-3 font-medium">
          {category(c)}
        </th>
        <td className="py-1 pr-3">{entity(c)}</td>
        <td className="py-1 pr-3">
          <Chip tone={tone(c.status)}>{label(c.status)}</Chip>
        </td>
        <td className="py-1 pr-3">{when(c.submittedAt)}</td>
        <td className="py-1 pr-3">
          {evidence}
          {c.similar.length ? `; ${c.similar.length} similar` : ""}
        </td>
        <td className="py-1 pr-3">
          <button type="button" className={btnSecondary} onClick={onOpen} aria-expanded={open} data-testid={`correction-open-${c.id}`}>
            Open<span className="sr-only"> {category(c)}, {entity(c)}</span>
          </button>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={6} className="pb-4">
            <Detail c={c} draftOpen={draftOpen} onAct={onAct} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Detail({ c, draftOpen, onAct }: { c: CorrectionItem; draftOpen: boolean; onAct: (c: CorrectionItem, p: ReviewPayload) => Promise<void> }) {
  return (
    <div className="grid gap-4 rounded-lg border border-ink-3/25 p-4 lg:grid-cols-2 dark:border-navy-raised" data-testid="correction-detail">
      <div className="grid gap-3 text-sm">
        <section aria-label="What the commuter wrote">
          <h3 className="font-semibold">What they wrote</h3>
          <p className="whitespace-pre-wrap">{c.description}</p>
        </section>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="font-medium">About</dt>
          <dd>
            {entity(c)} <span className="text-xs">({c.entityId})</span>
          </dd>
          {c.stop ? (
            <>
              <dt className="font-medium">Stop now</dt>
              <dd>
                {c.stop.name}, {label(c.stop.status)}, {c.stop.inDraft ? "in the open draft" : "published (no draft open)"}
                {c.stop.changedInDraft ? <> · <Chip tone="ok">edited in the draft</Chip></> : null}
              </dd>
            </>
          ) : null}
          <dt className="font-medium">Location</dt>
          <dd>{c.location ? `${c.location.lat.toFixed(6)}, ${c.location.lng.toFixed(6)}${c.location.accuracyM !== null ? ` (± ${Math.round(c.location.accuracyM)} m)` : ""}` : "Not given"}</dd>
          <dt className="font-medium">Advisory check</dt>
          <dd>{c.moderationReason ? label(c.moderationReason) : "–"}</dd>
          {c.reviewerNote ? (
            <>
              <dt className="font-medium">Reviewer note</dt>
              <dd className="whitespace-pre-wrap">{c.reviewerNote}</dd>
            </>
          ) : null}
          {c.draftChange ? (
            <>
              <dt className="font-medium">Change</dt>
              <dd>
                {c.draftChange.kind === "proposal" ? "Proposal (no automatic change)" : `New ${label(c.draftChange.entityKind ?? "")} version in the draft`}
                {c.draftChange.fareRuleVersionId ? `, about fare rule version ${c.draftChange.fareRuleVersionId.slice(0, 8)}` : ""}
              </dd>
            </>
          ) : null}
        </dl>
        {c.media.length ? (
          <section aria-label="Evidence photos">
            <h3 className="font-semibold">Photos (private; each view is logged)</h3>
            <ul className="mt-1 grid grid-cols-3 gap-2">
              {c.media.map((m, i) => (
                <li key={m.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={reviewMediaSrc(m.id)} alt={`Evidence photo ${i + 1}`} className="aspect-[4/3] w-full rounded object-cover" loading="lazy" />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {c.fares ? <FareTrace c={c} /> : null}
        {c.similar.length ? (
          <section aria-label="Similar reports">
            <h3 className="font-semibold">Similar reports on the same {c.entityType}</h3>
            <ul>
              {c.similar.map((s) => (
                <li key={s.id}>
                  {en.report.categories[s.kind as CorrectionItem["kind"]]?.label ?? label(s.kind)}, {label(s.status)}, {when(s.submittedAt)} <span className="text-xs">({s.id.slice(0, 8)})</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section aria-label="History">
          <h3 className="font-semibold">History</h3>
          <ol>
            {c.events.map((e, i) => (
              <li key={`${e.at}-${i}`}>
                {when(e.at)}: {e.from ? `${label(e.from)} → ` : ""}
                {label(e.to)}
                {e.actorRole ? ` (${label(e.actorRole)})` : ""}
                {e.reasonCode && e.actorRole !== "commuter" ? `, ${REASON_LABELS[e.reasonCode as keyof typeof REASON_LABELS] ?? label(e.reasonCode)}` : ""}
                {e.note && e.actorRole !== "commuter" ? `: ${e.note}` : ""}
              </li>
            ))}
          </ol>
        </section>
      </div>
      <ActionForm c={c} draftOpen={draftOpen} onAct={onAct} />
    </div>
  );
}

/** Fare reports: the published fare rules they may be about, with their sources, evidence and open conflicts (AC-13 traceability). */
function FareTrace({ c }: { c: CorrectionItem }) {
  const fares = c.fares ?? [];
  return (
    <section aria-label="Published fare rules">
      <h3 className="font-semibold">Published fare rules this may be about</h3>
      {fares.length === 0 ? (
        <Muted>No fare rule is published for this mode.</Muted>
      ) : (
        <table className="mt-1 w-full text-left text-xs" data-testid="fare-trace">
          <caption className="sr-only">Fare rules with sources and conflicts</caption>
          <thead>
            <tr>
              {["Rule", "Base", "Status", "Sources", "Evidence", "Open conflicts"].map((h) => (
                <th key={h} scope="col" className="pr-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fares.map((f) => (
              <tr key={f.versionId}>
                <th scope="row" className="pr-2 font-medium">
                  {f.code} ({f.modeCode})
                </th>
                <td className="pr-2">{pesos(f.baseCentavos)}</td>
                <td className="pr-2">{label(f.status)}</td>
                <td className="pr-2">{f.sourceCodes.join(", ") || "–"}</td>
                <td className="pr-2">{f.evidence.map((e) => `${label(e.claim)} (${e.sourceCode ?? e.kind})`).join("; ") || "none"}</td>
                <td className="pr-2">{f.openConflicts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

type AcceptKind = "relocate" | "retire" | "draft_version" | "proposal";

function ActionForm({ c, draftOpen, onAct }: { c: CorrectionItem; draftOpen: boolean; onAct: (c: CorrectionItem, p: ReviewPayload) => Promise<void> }) {
  const actions = reviewActions(c.status);
  const [action, setAction] = useState<ReviewAction | null>(actions[0] ?? null);
  const [reason, setReason] = useState<string>("");
  const [duplicateOf, setDuplicateOf] = useState<string>(c.similar[0]?.id ?? "");
  const stopEditable = Boolean(c.stop?.inDraft);
  const acceptKinds: { value: AcceptKind; text: string }[] = [
    ...(stopEditable && c.location ? [{ value: "relocate" as const, text: "Move the stop to the reported location (new stop version in the draft)" }] : []),
    ...(stopEditable ? [{ value: "retire" as const, text: "Retire the stop (new stop version in the draft)" }] : []),
    ...(c.stop?.changedInDraft ? [{ value: "draft_version" as const, text: "Link the stop's version already edited in the draft" }] : []),
    { value: "proposal", text: "Record a proposal (no automatic change; the note says what to change)" },
  ];
  const [kind, setKind] = useState<AcceptKind>(acceptKinds[0]!.value);
  const [fareRule, setFareRule] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (actions.length === 0) {
    return (
      <div className="text-sm">
        <Muted>{c.status === "accepted" ? "Accepted. It becomes incorporated when its draft is published." : "No further review action."}</Muted>
      </div>
    );
  }

  const build = (): ReviewPayload | string => {
    const base = { expectedStatus: c.status, ...(note.trim() ? { note: note.trim() } : {}) };
    switch (action) {
      case "start_review":
        return { action, ...base };
      case "request_info":
        if (!(INFO_REASONS as readonly string[]).includes(reason)) return "Choose what information is needed.";
        return { action, ...base, reason: reason as (typeof INFO_REASONS)[number] };
      case "reject":
        if (!(REJECT_REASONS as readonly string[]).includes(reason)) return "Choose a reason for rejecting.";
        return { action, ...base, reason: reason as (typeof REJECT_REASONS)[number] };
      case "duplicate":
        if (!/^[0-9a-f-]{36}$/i.test(duplicateOf.trim())) return "Choose or paste the report this one duplicates.";
        return { action, ...base, duplicateOf: duplicateOf.trim() };
      case "accept": {
        if (!draftOpen) return "Open a draft under Revisions & publication first.";
        const why = `Commuter correction ${c.id.slice(0, 8)}${note.trim() ? `: ${note.trim()}` : ""}`.slice(0, 500);
        let change: AcceptChange;
        if (kind === "relocate" && c.stop && c.location) {
          change = { kind: "stop_action", stopPointId: c.stop.stopPointId, stopAction: { action: "relocate", expectedVersionId: c.stop.versionId, lat: c.location.lat, lng: c.location.lng, reason: why } };
        } else if (kind === "retire" && c.stop) {
          change = { kind: "stop_action", stopPointId: c.stop.stopPointId, stopAction: { action: "retire", expectedVersionId: c.stop.versionId, reason: why } };
        } else if (kind === "draft_version" && c.stop) {
          change = { kind: "draft_version", versionId: c.stop.versionId };
        } else {
          if (!note.trim()) return "A proposal needs a note that says what to change.";
          change = { kind: "proposal" };
        }
        return { action, ...base, change, ...(fareRule ? { fareRuleVersionId: fareRule } : {}) };
      }
      default:
        return "Choose an action.";
    }
  };

  return (
    <form
      className="grid content-start gap-3 text-sm"
      aria-label="Review action"
      onSubmit={(e) => {
        e.preventDefault();
        const p = build();
        if (typeof p === "string") return setProblem(p);
        setProblem(null);
        setBusy(true);
        void onAct(c, p).finally(() => setBusy(false));
      }}
    >
      <fieldset className="grid gap-1">
        <legend className="mb-1 font-semibold">Action</legend>
        {actions.map((a) => (
          <label key={a} className="flex items-center gap-2">
            <input type="radio" name={`action-${c.id}`} value={a} checked={action === a} onChange={() => { setAction(a); setReason(""); }} />
            {ACTION_LABELS[a]}
          </label>
        ))}
      </fieldset>
      {action === "request_info" || action === "reject" ? (
        <Field label={action === "request_info" ? "What is needed (the reporter sees this, in their language)" : "Reason (the reporter sees this, in their language)"}>
          <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="correction-reason">
            <option value="">Choose…</option>
            {(action === "request_info" ? INFO_REASONS : REJECT_REASONS).map((r) => (
              <option key={r} value={r}>
                {REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {action === "duplicate" ? (
        <Field label="Duplicate of" hint="A similar report on the same item, or paste a report id.">
          <input className={inputCls} list={`similar-${c.id}`} value={duplicateOf} onChange={(e) => setDuplicateOf(e.target.value)} />
          <datalist id={`similar-${c.id}`}>
            {c.similar.map((s) => (
              <option key={s.id} value={s.id}>
                {label(s.status)}
              </option>
            ))}
          </datalist>
        </Field>
      ) : null}
      {action === "accept" ? (
        <>
          <fieldset className="grid gap-1">
            <legend className="mb-1 font-semibold">Change in the draft</legend>
            {acceptKinds.map((k) => (
              <label key={k.value} className="flex items-center gap-2">
                <input type="radio" name={`kind-${c.id}`} value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} />
                {k.text}
              </label>
            ))}
          </fieldset>
          {c.fares && c.fares.length > 0 ? (
            <Field label="Fare rule this is about (optional, recorded for tracing)">
              <select className={inputCls} value={fareRule} onChange={(e) => setFareRule(e.target.value)}>
                <option value="">None</option>
                {c.fares.map((f) => (
                  <option key={f.versionId} value={f.versionId}>
                    {f.code} {pesos(f.baseCentavos)} ({label(f.status)})
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </>
      ) : null}
      <Field label="Note (reviewers only; never shown to the reporter)">
        <textarea className={inputCls} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} data-testid="correction-note" />
      </Field>
      {problem ? <ErrorNote>{problem}</ErrorNote> : null}
      <div>
        <button type="submit" className={btnPrimary} disabled={busy || action === null} data-testid="correction-submit">
          {action ? ACTION_LABELS[action] : "Choose an action"}
        </button>
      </div>
    </form>
  );
}
