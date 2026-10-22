"use client";

import { useCallback, useEffect, useState } from "react";
import { decidePair, fetchReconciliation, type AdminResult } from "@/client/admin/api";
import { label, PIN_MISMATCH_M, type Reconciliation } from "@/domain/admin/stops";
import { btnPrimary, btnSecondary, Chip, ErrorNote, Field, inputCls, Muted, OkNote, PageTitle, Panel, when } from "./parts";

// A7 Reconciliation (N5b, C3). Stops of the open draft within 15 m of each other: never merged
// automatically; a reviewer links them (one kept, the other retired, its pins added to the kept
// stop) or keeps them separate. Below, read-only: stops whose source pin is far away or named
// differently.

type Pair = Reconciliation["pairs"][number];
type Choice = "keep_a" | "keep_b" | "keep_separate";

const who = (s: Pair["a"]) => `${s.layer?.replace(/^Loop Service /, "") ?? ""} ${s.code ?? ""} ${s.name}`.replace(/\s+/g, " ").trim();

export function ReconciliationScreen() {
  const [state, setState] = useState<AdminResult<Reconciliation> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => setState(await fetchReconciliation()), []);
  useEffect(() => {
    let live = true;
    void fetchReconciliation().then((r) => live && setState(r));
    return () => {
      live = false;
    };
  }, []);

  const data = state?.ok ? state.data : null;
  const key = (p: Pair) => `${p.a.stopPointId}:${p.b.stopPointId}`;

  const decide = async (p: Pair, choice: Choice, note: string) => {
    const r = await decidePair({
      a: { stopPointId: p.a.stopPointId, expectedVersionId: p.a.versionId },
      b: { stopPointId: p.b.stopPointId, expectedVersionId: p.b.versionId },
      decision: choice === "keep_separate" ? "keep_separate" : "link",
      ...(choice === "keep_a" ? { keepStopPointId: p.a.stopPointId } : choice === "keep_b" ? { keepStopPointId: p.b.stopPointId } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setNotice(
      r.ok
        ? { ok: true, text: choice === "keep_separate" ? `Kept ${who(p.a)} and ${who(p.b)} separate.` : `Linked: kept ${who(choice === "keep_a" ? p.a : p.b)}, retired the other.` }
        : { ok: false, text: r.message },
    );
    if (r.ok) setOpen(null);
    await load();
  };

  return (
    <div data-testid="admin-reconciliation">
      <PageTitle lead="Stops within 15 m of each other, from the same or different layers. Nothing is merged automatically: link two pins that are one stop, or keep them separate. Decisions go into the open draft.">
        Reconciliation
      </PageTitle>
      {notice ? <div className="mb-4">{notice.ok ? <OkNote testId="reconcile-notice">{notice.text}</OkNote> : <ErrorNote testId="reconcile-notice">{notice.text}</ErrorNote>}</div> : null}
      {state === null ? (
        <Muted>Loading…</Muted>
      ) : !state.ok ? (
        <ErrorNote>{state.message}</ErrorNote>
      ) : (
        <div className="grid gap-6">
          {!data?.editable ? <Muted>No draft is open: decisions need a draft (Revisions & publication).</Muted> : null}
          <Panel title={`Nearby stops to decide (${data?.pairs.length ?? 0})`} testId="pairs">
            {data?.pairs.length === 0 ? (
              <Muted>Nothing to decide.</Muted>
            ) : (
              <table className="w-full text-left text-sm" data-testid="pairs-table">
                <caption className="sr-only">Pairs of stops within 15 m</caption>
                <thead>
                  <tr>
                    {["First stop", "Second stop", "Distance", "Names", ""].map((h, i) => (
                      <th key={h || i} scope="col" className="py-1 pr-3 font-semibold">
                        {h || <span className="sr-only">Decide</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data!.pairs.map((p) => (
                    <PairRow key={key(p)} pair={p} open={open === key(p)} editable={data!.editable} onOpen={() => setOpen(open === key(p) ? null : key(p))} onDecide={decide} />
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <Panel title={`Stops and their source pins that disagree (${data?.mismatches.length ?? 0})`} testId="mismatches">
            <Muted>{`A pin more than ${PIN_MISMATCH_M} m from its stop, or labelled differently from the stop's name. Read-only: relocate or rename the stop under Candidate review or Stops & curbs.`}</Muted>
            {data?.mismatches.length ? (
              <table className="mt-3 w-full text-left text-sm" data-testid="mismatches-table">
                <caption className="sr-only">Stops that disagree with a source pin</caption>
                <thead>
                  <tr>
                    {["Stop", "Status", "Pin", "Pin label", "Distance", "Why"].map((h) => (
                      <th key={h} scope="col" className="py-1 pr-3 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.mismatches.map((m, i) => (
                    <tr key={`${m.stopPointId}-${m.pinCode}-${i}`} className="border-t border-fill dark:border-navy-raised">
                      <th scope="row" className="py-1 pr-3 font-medium">{m.name}</th>
                      <td className="py-1 pr-3">{label(m.status)}</td>
                      <td className="py-1 pr-3">
                        {m.pinLayer} {m.pinCode}
                      </td>
                      <td className="py-1 pr-3">{m.pinLabel}</td>
                      <td className="py-1 pr-3 tabular-nums">{m.distanceM} m</td>
                      <td className="py-1 pr-3">{[m.far && "far", m.nameDiffers && "name differs"].filter(Boolean).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </Panel>

          <Panel title="Recent decisions" testId="decisions">
            {data?.decisions.length ? (
              <ul className="grid gap-1 text-sm">
                {data.decisions.map((d) => (
                  <li key={d.id}>
                    <Chip>{d.decision === "link" ? "linked" : "kept separate"}</Chip> {d.a} and {d.b} ({d.distanceM} m)
                    {d.kept ? `, kept ${d.kept}` : ""}, {when(d.decidedAt)}
                    {d.note ? `: ${d.note}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <Muted>None yet.</Muted>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

function PairRow({
  pair,
  open,
  editable,
  onOpen,
  onDecide,
}: {
  pair: Pair;
  open: boolean;
  editable: boolean;
  onOpen: () => void;
  onDecide: (p: Pair, c: Choice, note: string) => Promise<void>;
}) {
  const [choice, setChoice] = useState<Choice>("keep_separate");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const id = `${pair.a.code ?? pair.a.stopPointId}-${pair.b.code ?? pair.b.stopPointId}`;
  return (
    <>
      <tr className="border-t border-fill dark:border-navy-raised" data-testid={`pair-${id}`}>
        <td className="py-1 pr-3">
          {who(pair.a)} <span className="text-xs">({label(pair.a.status)})</span>
        </td>
        <td className="py-1 pr-3">
          {who(pair.b)} <span className="text-xs">({label(pair.b.status)})</span>
        </td>
        <td className="py-1 pr-3 tabular-nums">{pair.distanceM === 0 ? "Same point" : `${pair.distanceM} m`}</td>
        <td className="py-1 pr-3">{pair.similarNames ? "Similar" : <Chip tone="warn">Different</Chip>}</td>
        <td className="py-1 pr-3">
          <button type="button" className={btnSecondary} onClick={onOpen} aria-expanded={open} data-testid={`pair-open-${id}`}>
            Decide<span className="sr-only"> on {who(pair.a)} and {who(pair.b)}</span>
          </button>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={5} className="pb-3">
            <form
              className="grid gap-3 rounded-md border border-fill p-3 md:grid-cols-[auto_1fr_auto] dark:border-navy-raised"
              onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                void onDecide(pair, choice, note).finally(() => setBusy(false));
              }}
            >
              <fieldset className="grid gap-1 text-sm">
                <legend className="mb-1 font-medium">Decision</legend>
                {(
                  [
                    ["keep_separate", "Keep separate"],
                    ["keep_a", `Link, keep ${who(pair.a)}`],
                    ["keep_b", `Link, keep ${who(pair.b)}`],
                  ] as const
                ).map(([value, text]) => (
                  <label key={value} className="flex items-center gap-2">
                    <input type="radio" name={`decision-${id}`} value={value} checked={choice === value} onChange={() => setChoice(value)} />
                    {text}
                  </label>
                ))}
              </fieldset>
              <Field label="Note (optional)">
                <input className={inputCls} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <div className="self-end">
                <button type="submit" className={btnPrimary} disabled={!editable || busy} data-testid={`pair-go-${id}`}>
                  Record decision
                </button>
              </div>
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}
