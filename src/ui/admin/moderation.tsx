"use client";

import { useCallback, useEffect, useState } from "react";
import { decideItem, fetchModeration, resolveAppeal, reviewMediaSrc, type AdminResult } from "@/client/admin/api";
import { label } from "@/domain/admin/stops";
import {
  isOverride,
  percent,
  REASON_LABELS,
  reasonsFor,
  type AppealItem,
  type ModerationItem,
  type ModerationQueue,
  type ModerationReason,
} from "@/domain/admin/moderation";
import { btnPrimary, btnSecondary, Chip, ErrorNote, Field, inputCls, Muted, OkNote, PageTitle, Panel, when } from "./parts";

// A15 Community moderation and A16 Appeals (N6, C10). Posts, comments and photos waiting for a
// person, with Jev's typed answer as a probability (advice, never a decision). Going against it is
// an override: a note is required and the decision is audited as one. Approving a photo copies it
// to the public bucket, the only way a photo becomes public. An edit of a live post is its own
// item; the live version stays until the edit is approved. Moderators never see their own content,
// and an appeal is never shown to the moderator who made the decision.

const KIND_LABEL: Record<ModerationItem["kind"], string> = { post_version: "Post", comment: "Comment", photo: "Photo" };

function JevLine({ jev }: { jev: ModerationItem["jev"] }) {
  if (!jev) return <span>Jev: no answer on file</span>;
  if (!jev.recommendation) return <span>Jev: unavailable ({label(jev.unavailableReason ?? "unknown")})</span>;
  return (
    <span>
      Jev: {label(jev.recommendation)} at {percent(jev.confidence)}
      {jev.policyVersion ? <span className="text-xs"> ({jev.policyVersion})</span> : null}
    </span>
  );
}

export function ModerationScreen() {
  const [state, setState] = useState<AdminResult<ModerationQueue> | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => setState(await fetchModeration()), []);
  useEffect(() => {
    let live = true;
    void fetchModeration().then((r) => live && setState(r));
    return () => {
      live = false;
    };
  }, []);

  const data = state?.ok ? state.data : null;

  return (
    <div data-testid="admin-moderation">
      <PageTitle lead="Posts, comments and photos waiting for a person. Jev's answer is advice: deciding against it is an override and needs a note. Approving a photo is the only way it becomes public. You never see your own content, and appeals go to someone other than who decided.">
        Moderation & appeals
      </PageTitle>
      {notice ? <div className="mb-4">{notice.ok ? <OkNote testId="moderation-notice">{notice.text}</OkNote> : <ErrorNote testId="moderation-notice">{notice.text}</ErrorNote>}</div> : null}
      {state === null ? (
        <Muted>Loading…</Muted>
      ) : !state.ok ? (
        <ErrorNote>{state.message}</ErrorNote>
      ) : (
        <div className="grid gap-6">
          <Panel title={`Waiting for review (${data?.items.length ?? 0})`} testId="moderation-items">
            {data?.items.length === 0 ? (
              <Muted>Nothing is waiting.</Muted>
            ) : (
              <ul className="grid gap-4">
                {data!.items.map((item) => (
                  <ItemCard
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    onDone={async (text, ok) => {
                      setNotice({ ok, text });
                      await load();
                    }}
                  />
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`Appeals (${data?.appeals.length ?? 0})`} testId="moderation-appeals">
            {data?.appeals.length === 0 ? (
              <Muted>No open appeal for you. Appeals of your own decisions go to another moderator.</Muted>
            ) : (
              <ul className="grid gap-4">
                {data!.appeals.map((a) => (
                  <AppealCard
                    key={a.id}
                    appeal={a}
                    onDone={async (text, ok) => {
                      setNotice({ ok, text });
                      await load();
                    }}
                  />
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Recent decisions" testId="moderation-history">
            {data?.history.length ? (
              <table className="w-full text-left text-sm" data-testid="moderation-history-table">
                <caption className="sr-only">The 50 most recent moderation decisions</caption>
                <thead>
                  <tr>
                    {["When", "Item", "Outcome", "Reason", "By", "Flags"].map((h) => (
                      <th key={h} scope="col" className="py-1 pr-3 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((h) => (
                    <tr key={h.id} className="border-t border-fill dark:border-navy-raised">
                      <td className="py-1 pr-3">{when(h.at)}</td>
                      <td className="py-1 pr-3">{KIND_LABEL[h.targetType]}</td>
                      <td className="py-1 pr-3">{h.outcome === "published" ? "Published" : "Not published"}</td>
                      <td className="py-1 pr-3">{REASON_LABELS[h.reasonCode as ModerationReason] ?? label(h.reasonCode)}</td>
                      <td className="py-1 pr-3">{h.mine ? "You" : h.deciderRole === "policy" ? "Policy (Jev)" : label(h.deciderRole)}</td>
                      <td className="py-1 pr-3">
                        {h.isOverride ? <Chip tone="warn">override</Chip> : null} {h.appealed ? <Chip>appealed</Chip> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Muted>None yet.</Muted>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

function ItemCard({ item, onDone }: { item: ModerationItem; onDone: (text: string, ok: boolean) => Promise<void> }) {
  const [outcome, setOutcome] = useState<"published" | "rejected">(item.jev?.recommendation === "reject" ? "rejected" : "published");
  const [reason, setReason] = useState<ModerationReason>(outcome === "published" ? "meets_guidelines" : "spam");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const override = isOverride(item.jev?.recommendation, outcome);
  const id = `${item.kind}-${item.id}`;

  const submit = async () => {
    if ((override || reason === "other") && !note.trim()) return setProblem(override ? "Deciding against Jev's recommendation needs a note." : "The reason “Other” needs a note.");
    setProblem(null);
    setBusy(true);
    const r = await decideItem({ targetType: item.kind, targetId: item.id, outcome, reason, ...(note.trim() ? { note: note.trim() } : {}) });
    setBusy(false);
    await onDone(
      r.ok ? `${KIND_LABEL[item.kind]} ${outcome === "published" ? "published" : "not published"}${r.data.isOverride ? " (override of Jev, recorded)" : ""}.` : r.message,
      r.ok,
    );
  };

  return (
    <li className="grid gap-3 rounded-md border border-fill p-4 lg:grid-cols-[1fr_22rem] dark:border-navy-raised" data-testid={`item-${id}`}>
      <div className="grid content-start gap-2 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <Chip>{KIND_LABEL[item.kind]}</Chip>
          {item.isEdit ? <Chip tone="warn">edit of a live post</Chip> : null}
          {item.status === "human_review" ? <Chip tone="warn">needs a person</Chip> : null}
          <span>
            {item.authorHandle} · {when(item.submittedAt)}
          </span>
        </p>
        {item.title ? <h3 className="text-base font-semibold">{item.title}</h3> : null}
        {item.isEdit && item.liveTitle ? <Muted>Live version: {item.liveTitle}</Muted> : null}
        {item.body ? <p className="whitespace-pre-wrap">{item.body}</p> : null}
        {item.tags.length ? <p className="text-xs">{item.tags.map((t) => `#${t}`).join(" ")}</p> : null}
        {item.mediaId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={reviewMediaSrc(item.mediaId)} alt={`Photo waiting for review on “${item.title ?? "a post"}”`} className="max-h-72 w-auto rounded object-contain" loading="lazy" />
        ) : null}
        <p className="text-xs">
          {item.kind === "photo" ? "Photos are never sent to Jev." : <JevLine jev={item.jev} />}
          {item.reason ? ` · waiting because: ${label(item.reason)}` : ""}
          {item.openReports ? ` · ${item.openReports} open report${item.openReports === 1 ? "" : "s"}` : ""}
        </p>
      </div>
      <form
        className="grid content-start gap-2 text-sm"
        aria-label={`Decide on this ${KIND_LABEL[item.kind].toLowerCase()}`}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset className="grid gap-1">
          <legend className="mb-1 font-semibold">Decision</legend>
          {(["published", "rejected"] as const).map((o) => (
            <label key={o} className="flex items-center gap-2">
              <input
                type="radio"
                name={`outcome-${id}`}
                value={o}
                checked={outcome === o}
                onChange={() => {
                  setOutcome(o);
                  setReason(reasonsFor(o)[0]!);
                }}
              />
              {o === "published" ? (item.kind === "photo" ? "Approve and make public" : "Publish") : "Do not publish"}
            </label>
          ))}
        </fieldset>
        <Field label="Reason">
          <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value as ModerationReason)} data-testid={`reason-${id}`}>
            {reasonsFor(outcome).map((r) => (
              <option key={r} value={r}>
                {REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        {override ? <ErrorNote testId={`override-${id}`}>This goes against Jev&apos;s recommendation. Write why; it is recorded as an override.</ErrorNote> : null}
        <Field label={override || reason === "other" ? "Note (required)" : "Note (optional)"}>
          <textarea className={inputCls} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} data-testid={`note-${id}`} />
        </Field>
        {problem ? <ErrorNote>{problem}</ErrorNote> : null}
        <div>
          <button type="submit" className={outcome === "published" ? btnPrimary : btnSecondary} disabled={busy} data-testid={`decide-${id}`}>
            Record decision
          </button>
        </div>
      </form>
    </li>
  );
}

function AppealCard({ appeal, onDone }: { appeal: AppealItem; onDone: (text: string, ok: boolean) => Promise<void> }) {
  const [outcome, setOutcome] = useState<"upheld" | "overturned">("upheld");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    if (note.trim().length < 3) return setProblem("Write a note for the decision history.");
    setProblem(null);
    setBusy(true);
    const r = await resolveAppeal(appeal.id, { outcome, note: note.trim() });
    setBusy(false);
    await onDone(r.ok ? `Appeal ${outcome === "upheld" ? "upheld: stays unpublished" : "accepted: now published"}${r.data.isOverride ? " (override of Jev, recorded)" : ""}.` : r.message, r.ok);
  };

  return (
    <li className="grid gap-3 rounded-md border border-fill p-4 lg:grid-cols-[1fr_22rem] dark:border-navy-raised" data-testid={`appeal-${appeal.id}`}>
      <div className="grid content-start gap-2 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <Chip>{KIND_LABEL[appeal.targetType]}</Chip>
          <span>
            Decided {when(appeal.decidedAt)} by {appeal.decidedBy === "policy" ? "the policy (Jev, high certainty)" : "another moderator"}:{" "}
            {REASON_LABELS[appeal.reasonCode as ModerationReason] ?? label(appeal.reasonCode)}
          </span>
        </p>
        {appeal.jevRecommendation ? (
          <p className="text-xs">
            Jev: {label(appeal.jevRecommendation)} at {percent(appeal.jevConfidence)}
          </p>
        ) : null}
        {appeal.excerpt ? <p className="whitespace-pre-wrap">{appeal.excerpt}</p> : null}
        {appeal.mediaId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={reviewMediaSrc(appeal.mediaId)} alt="The appealed photo" className="max-h-72 w-auto rounded object-contain" loading="lazy" />
        ) : null}
        <div>
          <h3 className="font-semibold">The author says</h3>
          <p className="whitespace-pre-wrap">{appeal.note}</p>
        </div>
      </div>
      <form
        className="grid content-start gap-2 text-sm"
        aria-label="Decide the appeal"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset className="grid gap-1">
          <legend className="mb-1 font-semibold">Outcome</legend>
          {(
            [
              ["upheld", "Uphold: keep it unpublished"],
              ["overturned", appeal.targetType === "photo" ? "Overturn: approve and make public" : "Overturn: publish it"],
            ] as const
          ).map(([value, text]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" name={`appeal-${appeal.id}`} value={value} checked={outcome === value} onChange={() => setOutcome(value)} />
              {text}
            </label>
          ))}
        </fieldset>
        {outcome === "overturned" && appeal.decidedBy === "policy" ? <Muted>Overturning the policy&apos;s decision is recorded as an override.</Muted> : null}
        <Field label="Note for the decision history (required)">
          <textarea className={inputCls} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} data-testid={`appeal-note-${appeal.id}`} />
        </Field>
        {problem ? <ErrorNote>{problem}</ErrorNote> : null}
        <div>
          <button type="submit" className={btnPrimary} disabled={busy} data-testid={`appeal-go-${appeal.id}`}>
            Record outcome
          </button>
        </div>
      </form>
    </li>
  );
}
