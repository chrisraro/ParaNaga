"use client";

import { useCallback, useEffect, useState } from "react";
import { decideItem, fetchModeration, resolveAppeal, resolveReports, reviewMediaSrc, takeDown, type AdminResult } from "@/client/admin/api";
import { label } from "@/domain/admin/stops";
import {
  isOverride,
  percent,
  REASON_LABELS,
  reasonsFor,
  REJECT_REASONS,
  reportReasonsText,
  type AppealItem,
  type ModerationItem,
  type ModerationQueue,
  type ModerationReason,
  type ReportItem,
} from "@/domain/admin/moderation";
import { btnPrimary, btnSecondary, Chip, ConfirmStep, ErrorNote, Field, inputCls, Muted, PageTitle, Panel, ResultNotice, useFormProblem, when, Empty, cardCls, Loading, LoadError, type Notice, TableScroll } from "./parts";

// A15 Community moderation and A16 Appeals (N6, C10). Posts, comments and photos waiting for a
// person, with Jev's typed answer as a probability (advice, never a decision). Going against it is
// an override: a note is required and the decision is audited as one. Approving a photo copies it
// to the public bucket, the only way a photo becomes public. An edit of a live post is its own
// item; the live version stays until the edit is approved. Moderators never see their own content,
// and an appeal is never shown to the moderator who made the decision.
// Reports (migration 0032): what riders reported, by item, never by whom. A person decides: take
// the published post, comment or photo down (reason, note, a confirm step; the author is told and
// can appeal, and the reports close as actioned), or dismiss the reports. Jev has no say here.

const KIND_LABEL: Record<ModerationItem["kind"], string> = { post_version: "Post", comment: "Comment", photo: "Photo" };
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
type RejectReason = (typeof REJECT_REASONS)[number];

function JevLine({ jev }: { jev: ModerationItem["jev"] }) {
  if (!jev) return <span>Jev: no answer on file</span>;
  if (!jev.recommendation) return <span>Jev: unavailable ({label(jev.unavailableReason ?? "unknown")})</span>;
  return (
    <span>
      Jev: {label(jev.recommendation)} at {percent(jev.confidence)}
      {jev.policyVersion ? <span className="adm-meta"> ({jev.policyVersion})</span> : null}
    </span>
  );
}

export function ModerationScreen() {
  const [state, setState] = useState<AdminResult<ModerationQueue> | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

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
      <PageTitle lead="Posts, comments and photos waiting for a person, and published content that riders reported. Jev's answer is advice: deciding against it is an override and needs a note. Approving a photo is the only way it becomes public. You never see your own content, and appeals go to someone other than who decided.">
        Moderation & appeals
      </PageTitle>
      {notice ? (
        <div className="mb-4">
          <ResultNotice notice={notice} testId="moderation-notice" />
        </div>
      ) : null}
      {state === null ? (
        <Loading />
      ) : !state.ok ? (
        <LoadError onRetry={() => { setState(null); void load(); }}>{state.message}</LoadError>
      ) : (
        <div className="grid gap-6">
          <Panel title={`Waiting for review (${data?.items.length ?? 0})`} variant="bare" testId="moderation-items">
            {data?.items.length === 0 ? (
              <Empty title="Nothing is waiting.">The queue is clear. New posts, comments and photos that need a person land here.</Empty>
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

          <Panel title={`Reports (${data?.reports.length ?? 0})`} variant="bare" testId="moderation-reports">
            {data?.reports.length === 0 ? (
              <Muted>No open report for you. Reports on your own content go to another moderator.</Muted>
            ) : (
              <ul className="grid gap-4">
                {data!.reports.map((r) => (
                  <ReportCard
                    key={`${r.targetType}-${r.targetId}`}
                    report={r}
                    onDone={async (text, ok) => {
                      setNotice({ ok, text });
                      await load();
                    }}
                  />
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`Appeals (${data?.appeals.length ?? 0})`} variant="bare" testId="moderation-appeals">
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
              <TableScroll label="Recent moderation decisions">
              <table className="w-full text-left text-sm" data-testid="moderation-history-table">
                <caption className="sr-only">The 50 most recent moderation decisions</caption>
                <thead>
                  <tr>
                    {["When", "Item", "Outcome", "Reason", "By", "Flags"].map((h) => (
                      <th key={h} scope="col">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((h) => (
                    <tr key={h.id}>
                      <td>{when(h.at)}</td>
                      <td>{KIND_LABEL[h.targetType]}</td>
                      <td>{h.outcome === "published" ? "Published" : "Not published"}</td>
                      <td>{REASON_LABELS[h.reasonCode as ModerationReason] ?? label(h.reasonCode)}</td>
                      <td>{h.mine ? "You" : h.deciderRole === "policy" ? "Policy (Jev)" : label(h.deciderRole)}</td>
                      <td>
                        {h.isOverride ? <Chip tone="warn">override</Chip> : null} {h.appealed ? <Chip>appealed</Chip> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </TableScroll>
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
  const [outcome, setOutcome] = useState<"published" | "rejected" | null>(null);
  const [reason, setReason] = useState<ModerationReason>("meets_guidelines");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const problem = useFormProblem();
  // Nothing is preselected: publishing is always the moderator's own choice (Jev is evidence only).
  const override = outcome !== null && isOverride(item.jev?.recommendation, outcome);
  const id = `${item.kind}-${item.id}`;

  const submit = async () => {
    // The radios are `required`, so the browser focuses the first one when none is chosen; this is the backstop.
    if (!outcome) return problem.fail("Choose a decision first.");
    if ((override || reason === "other") && !note.trim()) return problem.fail(override ? "Deciding against Jev's recommendation needs a note." : "The reason “Other” needs a note.", "note");
    problem.clear();
    setBusy(true);
    const r = await decideItem({ targetType: item.kind, targetId: item.id, outcome, reason, ...(note.trim() ? { note: note.trim() } : {}) });
    setBusy(false);
    await onDone(
      r.ok ? `${KIND_LABEL[item.kind]} ${outcome === "published" ? "published" : "not published"}${r.data.isOverride ? " (override of Jev, recorded)" : ""}.` : r.message,
      r.ok,
    );
  };

  return (
    <li className={`grid grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_22rem] ${cardCls}`} data-testid={`item-${id}`}>
      <div className="grid min-w-0 content-start gap-2 text-sm">
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
        {item.tags.length ? <p className="adm-meta">{item.tags.map((t) => `#${t}`).join(" ")}</p> : null}
        {item.mediaId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={reviewMediaSrc(item.mediaId)} alt={`Photo waiting for review on “${item.title ?? "a post"}”`} className="max-h-72 w-auto rounded-lg object-contain" loading="lazy" />
        ) : null}
        <p className="adm-meta">
          {item.kind === "photo" ? "Photos are never sent to Jev." : <JevLine jev={item.jev} />}
          {item.reason ? ` · waiting because: ${label(item.reason)}` : ""}
          {item.openReports ? ` · ${item.openReports} open report${item.openReports === 1 ? "" : "s"}` : ""}
        </p>
      </div>
      <form
        className="grid min-w-0 content-start gap-2 text-sm"
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
                required
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
        {outcome ? (
          <Field label="Reason">
            <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value as ModerationReason)} data-testid={`reason-${id}`}>
              {reasonsFor(outcome).map((r) => (
                <option key={r} value={r}>
                  {REASON_LABELS[r]}
                </option>
              ))}
            </select>
            </Field>
        ) : null}
        {override ? <ErrorNote testId={`override-${id}`}>This goes against Jev&apos;s recommendation. Write why; it is recorded as an override.</ErrorNote> : null}
        <Field label={override || reason === "other" ? "Note (required)" : "Note (optional)"} error={problem.errorFor("note")}>
          <textarea className={inputCls} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} data-testid={`note-${id}`} />
        </Field>
        {problem.general ? <ErrorNote>{problem.general}</ErrorNote> : null}
        <div>
          <button type="submit" className={outcome === "published" ? btnPrimary : btnSecondary} disabled={busy} aria-busy={busy} data-testid={`decide-${id}`}>
            Record decision
          </button>
        </div>
      </form>
    </li>
  );
}

/**
 * The open reports on one post or comment. The decision is "content" (take the reported item
 * down), one photo's id (take only that photo down) or "dismiss"; nothing is preselected, and a
 * take-down asks once more before it happens. Content that is already gone can only be closed.
 */
function ReportCard({ report, onDone }: { report: ReportItem; onDone: (text: string, ok: boolean) => Promise<void> }) {
  const [choice, setChoice] = useState<string | null>(null);
  const [reason, setReason] = useState<RejectReason | "">("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const problem = useFormProblem();
  const id = `${report.targetType}-${report.targetId}`;
  const kind = KIND_LABEL[report.contentKind];
  const thing = kind.toLowerCase();
  const reports = plural(report.count, "report");
  const live = report.state === "published" && report.contentId !== null;
  const photoNo = report.photos.findIndex((p) => p.id === choice) + 1;
  const what = photoNo ? `photo ${photoNo}` : `this ${thing}`;

  const close = async (status: "dismissed" | "actioned") => {
    setBusy(true);
    const r = await resolveReports(report.reportId, { status, lastAt: report.lastAt, contentId: report.contentId });
    setBusy(false);
    await onDone(r.ok ? (status === "dismissed" ? `${reports} dismissed. Nothing was changed.` : `${reports} closed.`) : r.message, r.ok);
  };

  const submit = () => {
    if (!choice) return problem.fail("Choose a decision first.");
    problem.clear();
    if (choice === "dismiss") return void close("dismissed");
    if (!reason) return problem.fail("Choose a reason.", "reason");
    if (reason === "other" && !note.trim()) return problem.fail("The reason “Other” needs a note.", "note");
    setConfirming(true);
  };

  const go = async () => {
    if (!reason || !report.contentId) return;
    setBusy(true);
    const r = await takeDown({
      targetType: photoNo ? "photo" : report.contentKind,
      targetId: photoNo ? choice! : report.contentId,
      reason,
      ...(note.trim() ? { note: note.trim() } : {}),
      lastAt: report.lastAt,
    });
    setBusy(false);
    setConfirming(false);
    await onDone(
      r.ok
        ? `${photoNo ? "Photo" : kind} taken down. ${r.data.reportsClosed ? `${plural(r.data.reportsClosed, "report")} closed as actioned.` : "No open report was left to close."}${
            r.data.publicCopy === "left" ? " Its public copy could not be deleted just now; it is no longer shown." : ""
          }`
        : r.message,
      r.ok,
    );
  };

  return (
    <li className={`grid grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_22rem] ${cardCls}`} data-testid={`report-${id}`}>
      <div className="grid min-w-0 content-start gap-2 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <Chip>{kind}</Chip>
          <Chip tone="warn">{reports}</Chip>
          {report.state === "taken_down" ? <Chip>taken down</Chip> : report.state === "deleted" ? <Chip>deleted by its author</Chip> : null}
          <span>
            {report.authorHandle} · first reported {when(report.firstAt)}
          </span>
        </p>
        <p>Reported for: {reportReasonsText(report.reasons)}</p>
        {report.title ? <h3 className="text-base font-semibold">{report.title}</h3> : null}
        {report.body ? <p className="whitespace-pre-wrap">{report.body}</p> : null}
        {report.photos.map((p, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={p.id} src={reviewMediaSrc(p.mediaId)} alt={`Public photo ${i + 1} on “${report.title ?? "this post"}”`} className="max-h-72 w-auto rounded-lg object-contain" loading="lazy" />
        ))}
        {report.notes.length ? (
          <div>
            <h3 className="font-semibold">Reporters wrote</h3>
            <ul className="grid list-disc gap-1 pl-5">
              {report.notes.map((n, i) => (
                <li key={i} className="whitespace-pre-wrap">
                  {n}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {live ? (
        <form
          className="grid min-w-0 content-start gap-2 text-sm"
          aria-label={`Decide on the reported ${thing}`}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <fieldset className="grid gap-1" disabled={confirming}>
            <legend className="mb-1 font-semibold">Decision</legend>
            {[
              ["content", `Take down this ${thing}`] as const,
              ...report.photos.map((p, i) => [p.id, `Take down photo ${i + 1} only`] as const),
              ["dismiss", "Dismiss: nothing needs to change"] as const,
            ].map(([value, text]) => (
              <label key={value} className="flex items-center gap-2">
                <input type="radio" name={`report-${id}`} required value={value} checked={choice === value} onChange={() => setChoice(value)} />
                {text}
              </label>
            ))}
          </fieldset>
          {choice && choice !== "dismiss" ? (
            <>
              <Field label="Reason" error={problem.errorFor("reason")}>
                <select className={inputCls} required disabled={confirming} value={reason} onChange={(e) => setReason(e.target.value as RejectReason)} data-testid={`report-reason-${id}`}>
                  <option value="" disabled>
                    Choose a reason
                  </option>
                  {REJECT_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {REASON_LABELS[r]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={reason === "other" ? "Note (required)" : "Note (optional)"} hint="For the decision history. The author does not see it." error={problem.errorFor("note")}>
                <textarea className={inputCls} rows={2} maxLength={1000} disabled={confirming} value={note} onChange={(e) => setNote(e.target.value)} data-testid={`report-note-${id}`} />
              </Field>
            </>
          ) : null}
          {problem.general ? <ErrorNote>{problem.general}</ErrorNote> : null}
          {confirming ? (
            <ConfirmStep title={`Take down ${what}?`} go="Take it down" danger busy={busy} onGo={() => void go()} onCancel={() => setConfirming(false)} testId={`report-confirm-${id}`}>
              {photoNo
                ? `The photo stops being shown; the ${thing} itself stays public. `
                : `Others will no longer see it${report.contentKind === "post_version" ? ", its comments or its photos" : ""}. `}
              {`The author is told and can ask for another review. The ${reports} on this ${thing} ${report.count === 1 ? "closes" : "close"} as actioned.`}
            </ConfirmStep>
          ) : null}
          {/* Stays mounted while the confirm step is open: Cancel puts focus back on it (useFocusOnOpen). */}
          <div hidden={confirming}>
            <button type="submit" className={btnSecondary} disabled={busy} aria-busy={busy} data-testid={`report-go-${id}`}>
              {choice === "dismiss" ? "Dismiss the reports" : choice ? "Take down…" : "Record decision"}
            </button>
          </div>
        </form>
      ) : (
        <div className="grid min-w-0 content-start gap-2 text-sm">
          <Muted>
            {report.state === "deleted" ? `The author deleted this ${thing}.` : `This ${thing} was already taken down.`} It is no longer public, so closing the reports is all that is left.
          </Muted>
          <div>
            <button type="button" className={btnSecondary} disabled={busy} aria-busy={busy} onClick={() => void close(report.state === "taken_down" ? "actioned" : "dismissed")} data-testid={`report-close-${id}`}>
              Close the reports
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function AppealCard({ appeal, onDone }: { appeal: AppealItem; onDone: (text: string, ok: boolean) => Promise<void> }) {
  const [outcome, setOutcome] = useState<"upheld" | "overturned">("upheld");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const problem = useFormProblem();

  const submit = async () => {
    if (note.trim().length < 3) return problem.fail("Write a note for the decision history (at least 3 characters).", "note");
    problem.clear();
    setBusy(true);
    const r = await resolveAppeal(appeal.id, { outcome, note: note.trim() });
    setBusy(false);
    await onDone(r.ok ? `Appeal ${outcome === "upheld" ? "upheld: stays unpublished" : "accepted: now published"}${r.data.isOverride ? " (override of Jev, recorded)" : ""}.` : r.message, r.ok);
  };

  return (
    <li className={`grid grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_22rem] ${cardCls}`} data-testid={`appeal-${appeal.id}`}>
      <div className="grid min-w-0 content-start gap-2 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <Chip>{KIND_LABEL[appeal.targetType]}</Chip>
          <span>
            Decided {when(appeal.decidedAt)} by {appeal.decidedBy === "policy" ? "the policy (Jev, high certainty)" : "another moderator"}:{" "}
            {REASON_LABELS[appeal.reasonCode as ModerationReason] ?? label(appeal.reasonCode)}
          </span>
        </p>
        {appeal.jevRecommendation ? (
          <p className="adm-meta">
            Jev: {label(appeal.jevRecommendation)} at {percent(appeal.jevConfidence)}
          </p>
        ) : null}
        {appeal.excerpt ? <p className="whitespace-pre-wrap">{appeal.excerpt}</p> : null}
        {appeal.mediaId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={reviewMediaSrc(appeal.mediaId)} alt="The appealed photo" className="max-h-72 w-auto rounded-lg object-contain" loading="lazy" />
        ) : null}
        <div>
          <h3 className="font-semibold">The author says</h3>
          <p className="whitespace-pre-wrap">{appeal.note}</p>
        </div>
      </div>
      <form
        className="grid min-w-0 content-start gap-2 text-sm"
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
        <Field label="Note for the decision history (required)" error={problem.errorFor("note")}>
          <textarea className={inputCls} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} data-testid={`appeal-note-${appeal.id}`} />
        </Field>
        <div>
          <button type="submit" className={btnPrimary} disabled={busy} aria-busy={busy} data-testid={`appeal-go-${appeal.id}`}>
            Record outcome
          </button>
        </div>
      </form>
    </li>
  );
}
