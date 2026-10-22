"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { fetchStops, stopAction, uploadStopPhoto, type AdminResult } from "@/client/admin/api";
import {
  CURB_SIDES,
  EVIDENCE_KINDS,
  STOP_CLAIMS,
  STOP_STATUSES,
  compareCodes,
  isCandidate,
  label,
  promotionOptions,
  type StopAction,
  type StopList,
  type StopRow,
} from "@/domain/admin/stops";
import { btnDanger, btnPrimary, btnSecondary, Chip, ErrorNote, Field, inputCls, Muted, OkNote, PageTitle, Panel, when } from "./parts";

// A3 Candidate review and A6 Stops & curbs (N5b, C3). One list of the open draft's stops; the
// selected stop's panel offers the actions of the screen. Every action is a new stop version in
// the draft (the database checks the role, the draft, the version this page saw, and the rules:
// promotion needs evidence of its claim, curb fields need curb evidence, a stop in a route's stop
// order cannot be retired). Publishing stays on Revisions & publication.

type Mode = "candidates" | "stops";
type Notice = { ok: boolean; text: string } | null;

const COPY: Record<Mode, { title: string; lead: string }> = {
  candidates: {
    title: "Candidate review",
    lead: "Source pins waiting for review. Attach evidence, then promote one step at a time; relocate a pin that sits in the wrong place, or retire one that is not a stop. Changes go into the open draft; validate and publish under Revisions & publication.",
  },
  stops: {
    title: "Stops and curbs",
    lead: "Names, other names, curb side and curb point, and boarding or alighting, per stop. Curb fields need curb position evidence first. Changes go into the open draft.",
  },
};

const coords = (lat: number, lng: number) => `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
const yesNo = (v: boolean | null) => (v === null ? "Not stated" : v ? "Yes" : "No");

export function StopsScreen({ mode }: { mode: Mode }) {
  const [list, setList] = useState<AdminResult<StopList> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>(mode === "candidates" ? "queue" : "all");
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => setList(await fetchStops()), []);
  useEffect(() => {
    let live = true;
    void fetchStops().then((r) => live && setList(r));
    return () => {
      live = false;
    };
  }, []);

  const data = list?.ok ? list.data : null;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.stops ?? [])
      .filter((s) => (status === "all" ? true : status === "queue" ? isCandidate(s.status) : s.status === status))
      .filter((s) => !q || [s.name, s.code ?? "", s.layer ?? "", s.labelRaw ?? "", ...s.aliases].some((t) => t.toLowerCase().includes(q)))
      .sort((a, b) => compareCodes(a.layer, b.layer) || compareCodes(a.code, b.code) || a.name.localeCompare(b.name));
  }, [data, query, status]);
  const selected = data?.stops.find((s) => s.stopPointId === selectedId) ?? null;

  const done = async (r: AdminResult<unknown>, text: string) => {
    setNotice(r.ok ? { ok: true, text } : { ok: false, text: r.message });
    await load();
    return r.ok;
  };

  const copy = COPY[mode];
  return (
    <div data-testid={`admin-${mode}`}>
      <PageTitle lead={copy.lead}>{copy.title}</PageTitle>

      {data && !data.editable ? (
        <div className="mb-4">
          <Muted>
            No draft is open, so this is {data.revision?.label ?? "the published revision"}, read-only. Create a draft under Revisions & publication to make changes.
          </Muted>
        </div>
      ) : data?.revision ? (
        <div className="mb-4">
          <Muted>Editing draft {data.revision.label}.</Muted>
        </div>
      ) : null}

      {notice ? <div className="mb-4">{notice.ok ? <OkNote testId="stops-notice">{notice.text}</OkNote> : <ErrorNote testId="stops-notice">{notice.text}</ErrorNote>}</div> : null}

      {list === null ? (
        <Muted>Loading…</Muted>
      ) : !list.ok ? (
        <ErrorNote testId="stops-error">{list.message}</ErrorNote>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div>
            <div className="mb-3 grid grid-cols-2 gap-3 md:max-w-xl">
              <Field label="Search">
                <input className={inputCls} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Code, name or label" data-testid="stops-search" />
              </Field>
              <Field label="Status">
                <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="stops-status">
                  {mode === "candidates" ? <option value="queue">Waiting for review</option> : null}
                  <option value="all">All statuses</option>
                  {STOP_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {label(s)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="max-h-[70vh] overflow-auto rounded-lg border border-fill bg-white dark:border-navy-raised dark:bg-navy">
              <table className="w-full text-left text-sm" data-testid="stops-table">
                <caption className="px-3 py-2 text-left text-sm text-ink-2 dark:text-slate-300">
                  {rows.length} of {data?.stops.length ?? 0} stops in {data?.revision?.label ?? "no revision"}
                </caption>
                <thead className="border-b border-fill dark:border-navy-raised">
                  <tr>
                    {["Layer", "Code", "Name", "Status", "Evidence", "Routes", ""].map((h, i) => (
                      <th key={h || i} scope="col" className="px-3 py-2 font-semibold">
                        {h || <span className="sr-only">Open</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr
                      key={s.stopPointId}
                      className={`border-b border-fill last:border-0 dark:border-navy-raised ${s.stopPointId === selectedId ? "bg-fill dark:bg-navy-raised" : ""}`}
                      data-testid={`stop-${s.layer ?? "x"}-${s.code ?? s.stopPointId}`}
                    >
                      <td className="px-3 py-2">{s.layer?.replace(/^Loop Service /, "") ?? "–"}</td>
                      <td className="px-3 py-2 tabular-nums">{s.code ?? "–"}</td>
                      <th scope="row" className="px-3 py-2 font-medium">
                        {s.name}
                        {s.isSynthetic ? <span className="ml-2 text-xs text-coral-ink dark:text-coral-bright">test data</span> : null}
                      </th>
                      <td className="px-3 py-2">{label(s.status)}</td>
                      <td className="px-3 py-2">{s.evidence.length === 0 ? "None" : [...new Set(s.evidence.map((e) => label(e.claim)))].join(", ")}</td>
                      <td className="px-3 py-2">{s.sequences.join(", ") || "–"}</td>
                      <td className="px-3 py-2">
                        <button type="button" className={btnSecondary} onClick={() => setSelectedId(s.stopPointId)} aria-pressed={s.stopPointId === selectedId}>
                          {mode === "candidates" ? "Review" : "Edit"}
                          <span className="sr-only"> {s.code ?? s.name}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            {selected ? (
              <StopPanel key={selected.versionId} stop={selected} mode={mode} editable={data?.editable === true} onDone={done} />
            ) : (
              <Panel title="No stop selected">
                <Muted>Pick a stop in the list to see its source pins and evidence.</Muted>
              </Panel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type Done = (r: AdminResult<unknown>, text: string) => Promise<boolean>;

function StopPanel({ stop, mode, editable, onDone }: { stop: StopRow; mode: Mode; editable: boolean; onDone: Done }) {
  const [busy, setBusy] = useState(false);
  const run = async (action: StopAction, text: string) => {
    setBusy(true);
    const r = await stopAction(stop.stopPointId, action);
    setBusy(false);
    return onDone(r, text);
  };
  const disabled = !editable || busy;
  return (
    <div className="grid gap-4" data-testid="stop-panel">
      <Panel title={`${stop.code ? `${stop.code} · ` : ""}${stop.name}`}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="font-medium">Status</dt>
          <dd data-testid="stop-status">{label(stop.status)}</dd>
          <dt className="font-medium">Position</dt>
          <dd className="tabular-nums" data-testid="stop-position">{coords(stop.lat, stop.lng)}</dd>
          <dt className="font-medium">Other names</dt>
          <dd>{stop.aliases.join(", ") || "None"}</dd>
          <dt className="font-medium">Curb side</dt>
          <dd>{stop.curbSide ? label(stop.curbSide) : "Not recorded"}</dd>
          <dt className="font-medium">Boarding / alighting</dt>
          <dd>
            {yesNo(stop.boardingAllowed)} / {yesNo(stop.alightingAllowed)}
          </dd>
          <dt className="font-medium">Route stop order</dt>
          <dd>{stop.sequences.join(", ") || "Not in any"}</dd>
          {stop.editNote ? (
            <>
              <dt className="font-medium">Last note</dt>
              <dd>{stop.editNote}</dd>
            </>
          ) : null}
        </dl>
        <h3 className="mt-4 mb-1 text-sm font-semibold">Source pins</h3>
        {stop.pins.length === 0 ? (
          <Muted>None.</Muted>
        ) : (
          <ul className="grid gap-1 text-sm" data-testid="stop-pins">
            {stop.pins.map((p, i) => (
              <li key={`${p.layer}-${p.code}-${i}`}>
                {p.layer} {p.code}: “{p.label}” at <span className="tabular-nums">{coords(p.lat, p.lng)}</span>
                {p.description && p.description !== p.label ? <span className="block text-xs text-ink-2 dark:text-slate-300">{p.description}</span> : null}
              </li>
            ))}
          </ul>
        )}
        <h3 className="mt-4 mb-1 text-sm font-semibold">Evidence</h3>
        {stop.evidence.length === 0 ? (
          <Muted>None linked to this version.</Muted>
        ) : (
          <ul className="grid gap-1 text-sm" data-testid="stop-evidence">
            {stop.evidence.map((e) => (
              <li key={`${e.id}-${e.claim}`}>
                <Chip>{label(e.claim)}</Chip> {label(e.kind)}
                {e.sourceCode ? ` (${e.sourceCode})` : ""}
                {e.hasMedia ? ", photo in the private bucket" : ""}
                {e.observedOn ? `, observed ${e.observedOn}` : ""}, added {when(e.createdAt)}
                {e.note ? <span className="block text-xs text-ink-2 dark:text-slate-300">{e.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {mode === "candidates" ? (
        <>
          <PromoteForm stop={stop} disabled={disabled} run={run} />
          <EvidenceForm stop={stop} disabled={disabled} run={run} setBusy={setBusy} onDone={onDone} />
          <RelocateForm stop={stop} disabled={disabled} run={run} />
          <RetireForm stop={stop} disabled={disabled} run={run} />
        </>
      ) : (
        <>
          <EditForm stop={stop} disabled={disabled} run={run} />
          <EvidenceForm stop={stop} disabled={disabled} run={run} setBusy={setBusy} onDone={onDone} />
        </>
      )}
    </div>
  );
}

type Run = (action: StopAction, text: string) => Promise<boolean>;
type FormProps = { stop: StopRow; disabled: boolean; run: Run };

function PromoteForm({ stop, disabled, run }: FormProps) {
  const options = promotionOptions(stop);
  const firstAllowed = options.find((o) => o.allowed)?.status ?? options[0]!.status;
  const [target, setTarget] = useState(firstAllowed);
  const [note, setNote] = useState("");
  const choice = options.find((o) => o.status === target)!;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run({ action: "promote", expectedVersionId: stop.versionId, status: target, ...(note.trim() ? { note: note.trim() } : {}) }, `${stop.code ?? stop.name} is now ${label(target)}.`);
  };
  return (
    <Panel title="Promote" testId="promote-form">
      <form className="grid gap-3" onSubmit={submit}>
        <Field label="New status" hint={choice.reason ?? `Evidence on file allows ${label(target)}.`}>
          <select className={inputCls} value={target} onChange={(e) => setTarget(e.target.value as typeof target)} data-testid="promote-status">
            {options.map((o) => (
              <option key={o.status} value={o.status}>
                {label(o.status)}
                {o.allowed ? "" : " (not yet)"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Note (optional)">
          <input className={inputCls} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div>
          <button type="submit" className={btnPrimary} disabled={disabled || !choice.allowed} data-testid="promote-go">
            Promote
          </button>
        </div>
      </form>
    </Panel>
  );
}

function EvidenceForm({
  stop,
  disabled,
  run,
  setBusy,
  onDone,
}: FormProps & { setBusy: (b: boolean) => void; onDone: Done }) {
  const [kind, setKind] = useState<(typeof EVIDENCE_KINDS)[number]>("document");
  const [claim, setClaim] = useState<(typeof STOP_CLAIMS)[number]>("legal_designation");
  const [note, setNote] = useState("");
  const [sourceCode, setSourceCode] = useState("");
  const [observedOn, setObservedOn] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    let mediaObjectId: string | undefined;
    if (file) {
      setBusy(true);
      const up = await uploadStopPhoto(file);
      setBusy(false);
      if (!up.ok) {
        await onDone(up, "");
        return;
      }
      mediaObjectId = up.data.mediaObjectId;
    }
    await run(
      {
        action: "evidence",
        expectedVersionId: stop.versionId,
        kind,
        claim,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(sourceCode.trim() ? { sourceCode: sourceCode.trim().toUpperCase() } : {}),
        ...(observedOn ? { observedOn } : {}),
        ...(mediaObjectId ? { mediaObjectId } : {}),
      },
      `Evidence for ${label(claim)} attached to ${stop.code ?? stop.name}.`,
    );
  };
  return (
    <Panel title="Attach evidence" testId="evidence-form">
      <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => void submit(e)}>
        <Field label="Kind">
          <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} data-testid="evidence-kind">
            {EVIDENCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {label(k)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="What it shows">
          <select className={inputCls} value={claim} onChange={(e) => setClaim(e.target.value as typeof claim)} data-testid="evidence-claim">
            {STOP_CLAIMS.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Source code (optional)" hint="A source in the register, e.g. S12.">
          <input className={inputCls} value={sourceCode} maxLength={31} onChange={(e) => setSourceCode(e.target.value)} data-testid="evidence-source" />
        </Field>
        <Field label="Observed on (optional)">
          <input className={inputCls} type="date" value={observedOn} onChange={(e) => setObservedOn(e.target.value)} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Note" hint="What the evidence says. A source code, a photo or a note is required.">
            <textarea className={inputCls} rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} data-testid="evidence-note" />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Photo (optional)" hint="JPEG, PNG or WebP up to 10 MB. Location and camera data are removed; it stays in the private bucket.">
            <input className={inputCls} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        </div>
        <div className="md:col-span-2">
          <button type="submit" className={btnPrimary} disabled={disabled || (kind === "photo" && !file)} data-testid="evidence-go">
            Attach evidence
          </button>
        </div>
      </form>
    </Panel>
  );
}

function RelocateForm({ stop, disabled, run }: FormProps) {
  const [lat, setLat] = useState(stop.lat.toFixed(7));
  const [lng, setLng] = useState(stop.lng.toFixed(7));
  const [reason, setReason] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run({ action: "relocate", expectedVersionId: stop.versionId, lat: Number(lat), lng: Number(lng), reason: reason.trim() }, `${stop.code ?? stop.name} moved.`);
  };
  const valid = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && reason.trim().length >= 3;
  return (
    <Panel title="Relocate" testId="relocate-form">
      <form className="grid gap-3 md:grid-cols-2" onSubmit={submit}>
        <Field label="Latitude">
          <input className={inputCls} inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} data-testid="relocate-lat" />
        </Field>
        <Field label="Longitude">
          <input className={inputCls} inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} data-testid="relocate-lng" />
        </Field>
        <div className="md:col-span-2">
          <Field label="Reason" hint="Recorded in the audit log. Curb evidence and the navigation approval are dropped.">
            <input className={inputCls} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="relocate-reason" />
          </Field>
        </div>
        <div>
          <button type="submit" className={btnSecondary} disabled={disabled || !valid || stop.status === "retired"} data-testid="relocate-go">
            Relocate
          </button>
        </div>
      </form>
    </Panel>
  );
}

function RetireForm({ stop, disabled, run }: FormProps) {
  const [reason, setReason] = useState("");
  const blocked = stop.sequences.length > 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run({ action: "retire", expectedVersionId: stop.versionId, reason: reason.trim() }, `${stop.code ?? stop.name} retired.`);
  };
  return (
    <Panel title="Retire" testId="retire-form">
      <form className="grid gap-3" onSubmit={submit}>
        {blocked ? <Muted>{`In the stop order of ${stop.sequences.join(", ")}: change the route's stops before retiring it.`}</Muted> : null}
        <Field label="Reason">
          <input className={inputCls} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="retire-reason" />
        </Field>
        <div>
          <button type="submit" className={btnDanger} disabled={disabled || blocked || reason.trim().length < 3 || stop.status === "retired"} data-testid="retire-go">
            Retire
          </button>
        </div>
      </form>
    </Panel>
  );
}

const triValue = (v: boolean | null) => (v === null ? "" : v ? "yes" : "no");
const fromTri = (v: string): boolean | null => (v === "" ? null : v === "yes");

function EditForm({ stop, disabled, run }: FormProps) {
  const [name, setName] = useState(stop.name);
  const [aliases, setAliases] = useState(stop.aliases.join(", "));
  const [curbSide, setCurbSide] = useState(stop.curbSide ?? "");
  const [curbLat, setCurbLat] = useState(stop.lat.toFixed(7));
  const [curbLng, setCurbLng] = useState(stop.lng.toFixed(7));
  const [boarding, setBoarding] = useState(triValue(stop.boardingAllowed));
  const [alighting, setAlighting] = useState(triValue(stop.alightingAllowed));
  const [note, setNote] = useState("");
  const curbEvidence = stop.evidence.some((e) => e.claim === "curb_position");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const changes: Extract<StopAction, { action: "edit" }>["changes"] = {};
    if (name.trim() && name.trim() !== stop.name) changes.name = name.trim();
    const list = aliases.split(",").map((a) => a.trim()).filter(Boolean);
    if (list.join("|") !== stop.aliases.join("|")) changes.aliases = list;
    if ((curbSide || null) !== stop.curbSide) changes.curbSide = (curbSide || null) as typeof changes.curbSide;
    if (Number(curbLat) !== Number(stop.lat.toFixed(7)) || Number(curbLng) !== Number(stop.lng.toFixed(7))) {
      changes.curbLat = Number(curbLat);
      changes.curbLng = Number(curbLng);
    }
    if (fromTri(boarding) !== stop.boardingAllowed) changes.boardingAllowed = fromTri(boarding);
    if (fromTri(alighting) !== stop.alightingAllowed) changes.alightingAllowed = fromTri(alighting);
    if (note.trim()) changes.note = note.trim();
    void run({ action: "edit", expectedVersionId: stop.versionId, changes }, `${stop.code ?? stop.name} updated.`);
  };
  return (
    <Panel title="Stop details" testId="edit-form">
      <form className="grid gap-3 md:grid-cols-2" onSubmit={submit}>
        <Field label="Name">
          <input className={inputCls} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-testid="edit-name" />
        </Field>
        <Field label="Other names" hint="Separated by commas, at most 10.">
          <input className={inputCls} value={aliases} onChange={(e) => setAliases(e.target.value)} data-testid="edit-aliases" />
        </Field>
        <Field label="Curb side" hint={curbEvidence ? undefined : "Needs curb position evidence first."}>
          <select className={inputCls} value={curbSide} disabled={!curbEvidence} onChange={(e) => setCurbSide(e.target.value)} data-testid="edit-curb-side">
            <option value="">Not recorded</option>
            {CURB_SIDES.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Curb latitude">
            <input className={inputCls} inputMode="decimal" value={curbLat} disabled={!curbEvidence} onChange={(e) => setCurbLat(e.target.value)} />
          </Field>
          <Field label="Curb longitude">
            <input className={inputCls} inputMode="decimal" value={curbLng} disabled={!curbEvidence} onChange={(e) => setCurbLng(e.target.value)} />
          </Field>
        </div>
        <Field label="Boarding allowed">
          <select className={inputCls} value={boarding} onChange={(e) => setBoarding(e.target.value)}>
            <option value="">Not stated</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </Field>
        <Field label="Alighting allowed">
          <select className={inputCls} value={alighting} onChange={(e) => setAlighting(e.target.value)}>
            <option value="">Not stated</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </Field>
        <div className="md:col-span-2">
          <Field label="Note (optional)">
            <input className={inputCls} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div>
          <button type="submit" className={btnPrimary} disabled={disabled || stop.status === "retired"} data-testid="edit-go">
            Save to draft
          </button>
        </div>
      </form>
    </Panel>
  );
}
