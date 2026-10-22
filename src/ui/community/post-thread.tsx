"use client";

// A post with its comments (S17, F-D2): two levels of replies, helpful reactions, bookmark, report,
// block, and for the author an edit and the history of versions. A pending edit is shown as such
// while the published version stays on screen. Guests can read everything here.

import "@/ui/kit/styles";
import "./community.css";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useAuthSession } from "@/client/auth/use-auth-session";
import {
  blockPerson,
  fetchCommunityMe,
  fetchPost,
  removeComment,
  removePost,
  reportPost,
  submitComment,
  toggleHelpful,
  toggleSaved,
} from "@/client/community/api";
import {
  COMMENT_MAX,
  NOTE_MAX,
  reportReasonsIn,
  validateComment,
  type CommentDto,
  type PostDetail,
  type ReportReason,
  type TargetType,
} from "@/domain/community/schemas";
import { stateHint, stateLabel } from "@/domain/community/status";
import { ConfirmDialog } from "@/ui/kit/confirm-dialog";
import { captureOpener } from "@/ui/kit/opener";
import { en, translated, type Dict } from "@/i18n/dict";
import { useT } from "@/i18n/provider";
import { GuidelinesAck, PostBadges, SignInPrompt, StateBadge, useFormatDate } from "./parts";

const apiText = (message: string, current: Dict["community"]["api"]) => translated(message, en.community.api, current);

type Load = { status: "loading" } | { status: "error"; message: string; notFound: boolean } | { status: "ready"; data: PostDetail };

export function PostThread({ id }: { id: string }) {
  const tt = useT();
  const t = tt.community;
  const formatDate = useFormatDate();
  const uid = useId();
  const router = useRouter();
  const { user, loading: authLoading } = useAuthSession();
  const signedIn = Boolean(user);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [guidelinesOk, setGuidelinesOk] = useState<boolean | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<{ type: TargetType; id: string } | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ type: TargetType; id: string } | null>(null);
  const [commentSent, setCommentSent] = useState<string | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const reportOpener = useRef<Element | null>(null);

  useEffect(() => {
    if (authLoading) return undefined;
    let cancelled = false;
    void fetchPost(id, signedIn).then((r) => {
      if (cancelled) return;
      setLoad(r.ok ? { status: "ready", data: r.data } : { status: "error", message: r.message, notFound: r.reason === "not_found" });
    });
    return () => {
      cancelled = true;
    };
  }, [id, signedIn, authLoading, reload]);

  useEffect(() => {
    if (!signedIn) return undefined;
    let cancelled = false;
    void fetchCommunityMe().then((r) => {
      if (!cancelled && r.ok) setGuidelinesOk(r.data.guidelinesAccepted);
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);

  const run = async (name: string, fn: () => Promise<{ ok: true } | { ok: false; message: string }>, after?: () => void) => {
    setBusy(name);
    setNote(null);
    const r = await fn();
    setBusy(null);
    if (!r.ok) return setNote(apiText(r.message, t.api));
    after?.();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape") return;
    if (report) {
      e.preventDefault();
      closeReport();
    } else if (replyTo) {
      e.preventDefault();
      setReplyTo(null);
    }
  };

  const openReport = (type: TargetType, targetId: string) => {
    reportOpener.current = captureOpener();
    setReport({ type, id: targetId });
  };
  const closeReport = () => {
    setReport(null);
    const back = reportOpener.current;
    reportOpener.current = null;
    if (back instanceof HTMLElement && back.isConnected) back.focus();
    else statusRef.current?.focus();
  };

  if (load.status === "loading" || authLoading) {
    return (
      <div className="pn-comm" data-testid="thread-loading">
        <p className="pn-comm__muted">{tt.forms.loading}</p>
      </div>
    );
  }
  if (load.status === "error") {
    return (
      <div className="pn-comm" data-testid="thread-error">
        <p className="pn-comm__error" role="alert">
          {load.notFound ? t.notAvailable : apiText(load.message, t.api)}
        </p>
        <div className="pn-comm__nav">
          {load.notFound ? null : (
            <button type="button" className="pn-btn pn-btn--secondary pn-comm__action" onClick={refresh}>
              {tt.forms.tryAgain}
            </button>
          )}
          <Link href="/app/community" className="pn-btn pn-btn--primary pn-comm__action">
            {t.backToCommunity}
          </Link>
        </div>
      </div>
    );
  }

  const { post, comments } = load.data;
  const live = post.state === "published";

  return (
    <div className="pn-comm" onKeyDown={onKeyDown} data-testid="thread">
      <article className="pn-comm__form" aria-labelledby={`${uid}-title`}>
        <PostBadges post={post} />
        <h2 id={`${uid}-title`} className="pn-comm__h2">
          {post.title}
        </h2>
        <div className="pn-comm__meta">
          <span>{post.isOwn ? t.you : post.authorHandle}</span>
          <span>{formatDate(post.createdAt)}</span>
        </div>
        <p className="pn-comm__body" data-testid="thread-body">
          {post.body}
        </p>
        {post.tags.length > 0 ? (
          <p className="pn-comm__muted">{post.tags.map((t) => `#${t}`).join(" ")}</p>
        ) : null}
        {post.label === "community" ? (
          <p className="pn-comm__notice" data-testid="thread-disclaimer">
            {t.unverifiedNotice}
          </p>
        ) : null}

        {post.isOwn && post.state !== "published" ? (
          <p ref={statusRef} tabIndex={-1} className={`pn-comm__status pn-comm__status--${post.state}`} role="status" data-testid="thread-state">
            {t.stateLine(stateLabel(post.state, t), stateHint(post.state, "post", t))}
          </p>
        ) : null}
        {post.isOwn && post.hasPendingEdit ? (
          <p className="pn-comm__status pn-comm__status--pending" role="status" data-testid="thread-edit-state">
            {t.editPendingNote}
          </p>
        ) : null}

        <div className="pn-comm__row">
          {live && signedIn && !post.isOwn ? (
            <button
              type="button"
              className="pn-btn pn-btn--secondary pn-comm__small"
              aria-pressed={post.viewerHelpful}
              disabled={busy === "helpful"}
              onClick={() =>
                void run("helpful", async () => {
                  const r = await toggleHelpful("post", post.id);
                  if (r.ok) setLoad({ status: "ready", data: { ...load.data, post: { ...post, viewerHelpful: r.data.active, helpfulCount: r.data.count ?? post.helpfulCount } } });
                  return r.ok ? { ok: true as const } : r;
                })
              }
              data-testid="thread-helpful"
            >
              {t.helpful(post.helpfulCount)}
            </button>
          ) : live ? (
            <span className="pn-comm__muted">{t.helpfulCount(post.helpfulCount)}</span>
          ) : null}
          {live && signedIn ? (
            <button
              type="button"
              className="pn-btn pn-btn--secondary pn-comm__small"
              aria-pressed={post.viewerBookmarked}
              disabled={busy === "bookmark"}
              onClick={() =>
                void run("bookmark", async () => {
                  const r = await toggleSaved(post.id);
                  if (r.ok) setLoad({ status: "ready", data: { ...load.data, post: { ...post, viewerBookmarked: r.data.active } } });
                  return r.ok ? { ok: true as const } : r;
                })
              }
              data-testid="thread-bookmark"
            >
              {post.viewerBookmarked ? t.saved : t.save}
            </button>
          ) : null}
          {post.isOwn ? (
            <>
              <Link href={`/app/community/${post.id}/edit`} className="pn-btn pn-btn--secondary pn-comm__small" data-testid="thread-edit">
                {t.edit}
              </Link>
              <button type="button" className="pn-btn pn-btn--secondary pn-comm__small pn-comm__danger" onClick={() => setConfirmDelete({ type: "post", id: post.id })} data-testid="thread-delete">
                {t.delete}
              </button>
            </>
          ) : live && signedIn ? (
            <details className="pn-comm__more">
              <summary>{t.more}</summary>
              <div className="pn-comm__row">
                <button type="button" className="pn-btn pn-btn--secondary pn-comm__small" onClick={() => openReport("post", post.id)} data-testid="thread-report">
                  {t.report}
                </button>
                <button
                  type="button"
                  className="pn-btn pn-btn--secondary pn-comm__small"
                  onClick={() =>
                    void run("block", () => blockPerson("post", post.id), () => router.replace("/app/community"))
                  }
                  data-testid="thread-block"
                >
                  {t.block}
                </button>
              </div>
            </details>
          ) : null}
        </div>

        {report && report.type === "post" ? <ReportForm key={report.id} target={report} onDone={closeReport} /> : null}

        {note ? (
          <p className="pn-comm__error" role="alert">
            {note}
          </p>
        ) : null}

        {post.isOwn && post.versions.length > 1 ? (
          <details className="pn-comm__more" data-testid="thread-history">
            <summary>{t.history(post.versions.length)}</summary>
            <ul className="pn-comm__history">
              {post.versions.map((v) => (
                <li key={v.n}>
                  <span>{t.version(v.n)}</span>
                  <span>{formatDate(v.submittedAt)}</span>
                  {v.isLive ? <span className="pn-comm__badge">{t.visibleToAll}</span> : <StateBadge state={v.state} />}
                  {!v.isLive && v.state === "published" ? <span className="pn-comm__muted">{t.replaced}</span> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </article>

      {live ? (
        <section className="pn-comm__form" aria-label={t.commentsLabel} data-testid="thread-comments">
          <h3 className="pn-comm__panel-title">{t.commentsLabel}</h3>
          {comments.length === 0 ? <p className="pn-comm__muted">{t.noComments}</p> : null}
          {comments.length > 0 ? (
            <CommentList
              comments={comments}
              signedIn={signedIn}
              busy={busy}
              replyTo={replyTo}
              onReply={setReplyTo}
              onHelpful={(c) =>
                void run("c-" + c.id, async () => {
                  const r = await toggleHelpful("comment", c.id);
                  if (r.ok) refresh();
                  return r.ok ? { ok: true as const } : r;
                })
              }
              onReport={(c) => openReport("comment", c.id)}
              onBlock={(c) => void run("block", () => blockPerson("comment", c.id), refresh)}
              onDelete={(c) => setConfirmDelete({ type: "comment", id: c.id })}
              report={report?.type === "comment" ? report : null}
              closeReport={closeReport}
              composer={(parentId) => (
                <CommentComposer
                  postId={post.id}
                  parentId={parentId}
                  needGuidelines={guidelinesOk === false}
                  onSent={(state) => {
                    setReplyTo(null);
                    setCommentSent(state);
                    refresh();
                  }}
                  onCancel={parentId ? () => setReplyTo(null) : undefined}
                />
              )}
            />
          ) : null}

          {commentSent ? (
            <p className={`pn-comm__status pn-comm__status--${commentSent}`} role="status" data-testid="comment-sent">
              {commentSent === "pending"
                ? t.commentPending
                : commentSent === "rejected"
                  ? t.commentRejected
                  : t.commentPosted}
            </p>
          ) : null}

          {!authLoading && !signedIn ? <SignInPrompt text={t.signInComment} /> : null}
          {signedIn && replyTo === null ? (
            <div className="pn-comm__panel">
              <h4 className="pn-comm__panel-title">{t.addComment}</h4>
              <CommentComposer
                postId={post.id}
                parentId={null}
                needGuidelines={guidelinesOk === false}
                onSent={(state) => {
                  setCommentSent(state);
                  refresh();
                }}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={confirmDelete?.type === "post" ? t.deletePost : t.deleteComment}
        confirmLabel={t.delete}
        tone="danger"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (!target) return;
          if (target.type === "post") void run("delete", () => removePost(target.id), () => router.replace("/app/community"));
          else void run("delete", () => removeComment(target.id), refresh);
        }}
      >
        <p>{t.deleteBody}</p>
      </ConfirmDialog>
    </div>
  );
}

type ListProps = {
  comments: CommentDto[];
  signedIn: boolean;
  busy: string | null;
  replyTo: string | null;
  onReply: (id: string | null) => void;
  onHelpful: (c: CommentDto) => void;
  onReport: (c: CommentDto) => void;
  onBlock: (c: CommentDto) => void;
  onDelete: (c: CommentDto) => void;
  report: { type: TargetType; id: string } | null;
  closeReport: () => void;
  composer: (parentId: string | null) => React.ReactNode;
};

function CommentList(props: ListProps) {
  const t = useT().community;
  const formatDate = useFormatDate();
  return (
    <ul className="pn-comm__comments">
      {props.comments.map((c) => (
        <li key={c.id} className="pn-comm__comment" data-testid="comment">
          <div className="pn-comm__meta">
            <span>{c.isOwn ? t.you : c.authorHandle}</span>
            <span>{formatDate(c.createdAt)}</span>
            <StateBadge state={c.state} />
          </div>
          <p className="pn-comm__body">{c.body}</p>
          {c.state !== "published" && c.isOwn ? <p className="pn-comm__hint">{stateHint(c.state, "comment", t)}</p> : null}
          <div className="pn-comm__row">
            {c.state === "published" ? (
              props.signedIn && !c.isOwn ? (
                <button
                  type="button"
                  className="pn-btn pn-btn--secondary pn-comm__small"
                  aria-pressed={c.viewerHelpful}
                  disabled={props.busy === `c-${c.id}`}
                  onClick={() => props.onHelpful(c)}
                >
                  {t.helpful(c.helpfulCount)}
                </button>
              ) : (
                <span className="pn-comm__muted">{t.helpfulCount(c.helpfulCount)}</span>
              )
            ) : null}
            {props.signedIn && c.depth === 1 && c.state === "published" ? (
              <button
                type="button"
                className="pn-btn pn-btn--secondary pn-comm__small"
                onClick={() => props.onReply(c.id)}
                aria-expanded={props.replyTo === c.id}
                data-testid="comment-reply"
              >
                {t.reply}
              </button>
            ) : null}
            {c.isOwn ? (
              <button type="button" className="pn-btn pn-btn--secondary pn-comm__small pn-comm__danger" onClick={() => props.onDelete(c)}>
                {t.delete}
              </button>
            ) : props.signedIn && c.state === "published" ? (
              <details className="pn-comm__more">
                <summary>{t.more}</summary>
                <div className="pn-comm__row">
                  <button type="button" className="pn-btn pn-btn--secondary pn-comm__small" onClick={() => props.onReport(c)}>
                    {t.report}
                  </button>
                  <button type="button" className="pn-btn pn-btn--secondary pn-comm__small" onClick={() => props.onBlock(c)}>
                    {t.block}
                  </button>
                </div>
              </details>
            ) : null}
          </div>
          {props.report?.id === c.id ? <ReportForm key={c.id} target={props.report} onDone={props.closeReport} /> : null}
          {props.replyTo === c.id ? <div className="pn-comm__panel">{props.composer(c.id)}</div> : null}
          {c.replies.length > 0 ? <CommentList {...props} comments={c.replies} /> : null}
        </li>
      ))}
    </ul>
  );
}

function CommentComposer({
  postId,
  parentId,
  needGuidelines,
  onSent,
  onCancel,
}: {
  postId: string;
  parentId: string | null;
  needGuidelines: boolean;
  onSent: (state: "published" | "pending" | "rejected") => void;
  onCancel?: () => void;
}) {
  const tt = useT();
  const t = tt.community;
  const uid = useId();
  const [text, setText] = useState("");
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (parentId) field.current?.focus();
  }, [parentId]);

  const send = async () => {
    const problem = validateComment(text, tt) ?? (needGuidelines && !ack ? t.tickGuidelines : null);
    if (problem) return setError(problem);
    setSending(true);
    setError(null);
    const r = await submitComment(postId, {
      clientRequestId: requestId,
      body: text.trim(),
      ...(parentId ? { parentCommentId: parentId } : {}),
      guidelinesAccepted: needGuidelines ? ack : true,
    });
    setSending(false);
    if (!r.ok) return setError(apiText(r.message, t.api));
    setText("");
    setRequestId(crypto.randomUUID());
    onSent(r.data.comment.state);
  };

  return (
    <div className="pn-comm__form">
      <div className="pn-comm__field">
        <label htmlFor={`${uid}-c`} className="pn-comm__label">
          {parentId ? t.yourReply : t.yourComment}
        </label>
        <textarea
          ref={field}
          id={`${uid}-c`}
          className="pn-comm__input pn-comm__textarea"
          rows={3}
          maxLength={COMMENT_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <span className="pn-comm__count">
          {tt.forms.count(text.trim().length, COMMENT_MAX)}
        </span>
      </div>
      {needGuidelines ? <GuidelinesAck id={`${uid}-g`} checked={ack} onChange={setAck} /> : null}
      {error ? (
        <p className="pn-comm__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pn-comm__row">
        <button type="button" className="pn-btn pn-btn--primary pn-comm__small" onClick={() => void send()} disabled={sending} data-testid="comment-send">
          {sending ? tt.forms.sending : parentId ? t.sendReply : t.sendComment}
        </button>
        {onCancel ? (
          <button type="button" className="pn-btn pn-btn--secondary pn-comm__small" onClick={onCancel}>
            {tt.kit.cancel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ReportForm({ target, onDone }: { target: { type: TargetType; id: string }; onDone: () => void }) {
  const tt = useT();
  const t = tt.community;
  const uid = useId();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [noteText, setNoteText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  if (done) {
    return (
      <div className="pn-comm__panel" data-testid="report-done">
        <p className="pn-comm__status" role="status">
          {t.reportDone}
        </p>
        <button type="button" className="pn-btn pn-btn--secondary pn-comm__small" onClick={onDone}>
          {t.close}
        </button>
      </div>
    );
  }

  const send = async () => {
    if (!reason) return setError(t.chooseReason);
    setSending(true);
    setError(null);
    const r = await reportPost(target.type, target.id, reason, noteText.trim() || undefined);
    setSending(false);
    if (r.ok) setDone(true);
    else setError(apiText(r.message, t.api));
  };

  return (
    <fieldset className="pn-comm__panel" data-testid="report-form">
      <legend className="pn-comm__panel-title">{target.type === "post" ? t.reportPost : t.reportComment}</legend>
      <div role="radiogroup" aria-label={t.reason}>
        {reportReasonsIn(t).map((r, i) => (
          <label key={r.value} className="pn-comm__option">
            <input ref={i === 0 ? first : undefined} type="radio" name={`${uid}-reason`} value={r.value} checked={reason === r.value} onChange={() => { setReason(r.value); setError(null); }} />
            <span className="pn-comm__option-label">{r.label}</span>
          </label>
        ))}
      </div>
      <div className="pn-comm__field">
        <label htmlFor={`${uid}-note`} className="pn-comm__label">
          {t.noteLabel}
        </label>
        <textarea id={`${uid}-note`} className="pn-comm__input pn-comm__textarea" rows={2} maxLength={NOTE_MAX} value={noteText} onChange={(e) => setNoteText(e.target.value)} />
      </div>
      {error ? (
        <p className="pn-comm__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="pn-comm__row">
        <button type="button" className="pn-btn pn-btn--primary pn-comm__small" onClick={() => void send()} disabled={sending} data-testid="report-send">
          {sending ? tt.forms.sending : t.sendReport}
        </button>
        <button type="button" className="pn-btn pn-btn--secondary pn-comm__small" onClick={onDone}>
          {tt.kit.cancel}
        </button>
      </div>
    </fieldset>
  );
}
