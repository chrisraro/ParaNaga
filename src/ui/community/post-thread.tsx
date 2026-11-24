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
  submitAppeal,
  submitComment,
  toggleHelpful,
  toggleSaved,
} from "@/client/community/api";
import {
  APPEAL_NOTE_MAX,
  APPEAL_NOTE_MIN,
  COMMENT_MAX,
  NOTE_MAX,
  reportReasonsIn,
  validateComment,
  type AppealState,
  type AppealTarget,
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
import { SignInUnknown } from "@/ui/auth/sign-in-unknown";
import { Live, updateThenFocus, useFieldError } from "@/ui/report/form-a11y";
import { GuidelinesAck, PostBadges, SignInPrompt, StateBadge, useFormatDate } from "./parts";

const apiText = (message: string, current: Dict["community"]["api"]) => translated(message, en.community.api, current);

type Load = { status: "loading" } | { status: "error"; message: string; notFound: boolean } | { status: "ready"; data: PostDetail };

export function PostThread({ id }: { id: string }) {
  const tt = useT();
  const t = tt.community;
  const formatDate = useFormatDate();
  const uid = useId();
  const router = useRouter();
  const { user, loading: authLoading, status: authStatus, refresh: recheckAuth, refreshing: recheckingAuth } = useAuthSession();
  const signedIn = Boolean(user);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [guidelinesOk, setGuidelinesOk] = useState<boolean | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // The actions in flight, by key ("helpful", "delete-<id>", ...). The ref answers "already sent?"
  // at once (two taps before a render); the state copy is what the buttons read.
  const inFlight = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [report, setReport] = useState<{ type: TargetType; id: string } | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ type: TargetType; id: string } | null>(null);
  const [confirmBlock, setConfirmBlock] = useState<{ type: "post" | "comment"; id: string } | null>(null);
  // Is there unsent text in the open reply? Escape and another Reply must not throw it away.
  const replyDraft = useRef(false);
  // Numbered, so a second comment that ends in the same state is announced again.
  const [commentSent, setSent] = useState<{ state: string; n: number } | null>(null);
  const setCommentSent = (state: string) => setSent((prev) => ({ state, n: (prev?.n ?? 0) + 1 }));
  const titleRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const commentsRef = useRef<HTMLHeadingElement>(null);
  const commentSentRef = useRef<HTMLParagraphElement>(null);
  // Set when the control in use may be gone after the next load: where focus goes then.
  const afterLoad = useRef<(() => HTMLElement | null) | null>(null);
  const reportOpener = useRef<Element | null>(null);

  useEffect(() => {
    if (authLoading) return undefined;
    let cancelled = false;
    void fetchPost(id, signedIn).then((r) => {
      if (cancelled) return;
      const next: Load = r.ok ? { status: "ready", data: r.data } : { status: "error", message: r.message, notFound: r.reason === "not_found" };
      const target = afterLoad.current;
      afterLoad.current = null;
      // A failed reload removes the page the focused control sat on: the message takes focus then.
      if (next.status === "error") updateThenFocus(() => setLoad(next), () => errorRef.current);
      else if (target) updateThenFocus(() => setLoad(next), target);
      else setLoad(next);
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
  const refreshThen = (target: () => HTMLElement | null) => {
    afterLoad.current = target;
    refresh();
  };
  const closeReply = (id: string, also?: () => void) =>
    updateThenFocus(
      () => {
        replyDraft.current = false;
        setReplyTo(null);
        also?.();
      },
      () => (also ? commentSentRef.current : document.getElementById(`reply-${id}`)),
    );

  const run = async (name: string, fn: () => Promise<{ ok: true } | { ok: false; message: string }>, after?: () => void) => {
    if (inFlight.current.has(name)) return;
    inFlight.current.add(name);
    setBusy(new Set(inFlight.current));
    setNote(null);
    setSent(null);
    const r = await fn();
    inFlight.current.delete(name);
    setBusy(new Set(inFlight.current));
    if (!r.ok) return setNote(apiText(r.message, t.api));
    after?.();
  };

  /** Patches the post on screen from the newest state, so two answers in a row never undo each other. */
  const patchPost = (patch: (post: PostDetail["post"]) => Partial<PostDetail["post"]>) =>
    setLoad((prev) => (prev.status === "ready" ? { ...prev, data: { ...prev.data, post: { ...prev.data.post, ...patch(prev.data.post) } } } : prev));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape") return;
    if (report) {
      e.preventDefault();
      closeReport();
    } else if (replyTo) {
      e.preventDefault();
      // Typed text is kept: Cancel is the way to throw it away.
      if (!replyDraft.current) closeReply(replyTo);
    }
  };

  const askDelete = (type: TargetType, targetId: string) => {
    if (!inFlight.current.has(`delete-${targetId}`)) setConfirmDelete({ type, id: targetId });
  };

  const askBlock = (type: "post" | "comment", targetId: string) => {
    if (!inFlight.current.has(`block-${targetId}`)) setConfirmBlock({ type, id: targetId });
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
    else titleRef.current?.focus();
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
        <p ref={errorRef} tabIndex={-1} className="pn-comm__error" role="alert">
          {load.notFound ? t.notAvailable : apiText(load.message, t.api)}
        </p>
        <div className="pn-comm__nav">
          {load.notFound ? null : (
            <button type="button" className="pn-btn pn-btn--secondary pn-comm__action" onClick={() => refreshThen(() => titleRef.current)}>
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
  // The author's newest version, when a person or the policy decided not to publish it (N6: appeal once).
  const latest = post.isOwn ? post.versions[0] : undefined;
  const shownPhotos = post.photos.filter((ph) => ph.state === "published");
  const ownPhotos = post.isOwn ? post.photos.filter((ph) => ph.state !== "published") : [];

  return (
    <div className="pn-comm" onKeyDown={onKeyDown} data-testid="thread">
      <article className="pn-comm__form" aria-labelledby={`${uid}-title`}>
        <PostBadges post={post} />
        <h2 ref={titleRef} tabIndex={-1} id={`${uid}-title`} className="pn-comm__h2">
          {post.title}
        </h2>
        <div className="pn-comm__meta">
          <span>{post.isOwn ? t.you : post.authorHandle}</span>
          <span>{formatDate(post.createdAt)}</span>
        </div>
        <p className="pn-comm__body" data-testid="thread-body">
          {post.body}
        </p>
        {shownPhotos.length > 0 ? (
          <ul className="pn-comm__photos" data-testid="thread-photos">
            {shownPhotos.map((ph, i) => (
              <li key={ph.id}>
                {/* Served from the public bucket only, after a moderator approved this photo. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="pn-comm__photo" src={`/api/v1/community/photos/${ph.id}`} alt={t.photos.alt(i + 1)} loading="lazy" decoding="async" />
              </li>
            ))}
          </ul>
        ) : null}
        {ownPhotos.map((ph) => (
          <div key={ph.id} className="pn-comm__panel" data-testid="thread-own-photo">
            <p className={`pn-comm__status pn-comm__status--${ph.state}`}>{ph.state === "rejected" ? t.photos.rejected : t.photos.pending}</p>
            {ph.state === "rejected" ? <AppealBox targetType="photo" targetId={ph.id} appeal={ph.appeal} onSent={refresh} /> : null}
          </div>
        ))}
        {post.tags.length > 0 ? (
          <p className="pn-comm__muted">{post.tags.map((t) => `#${t}`).join(" ")}</p>
        ) : null}
        {post.label === "community" ? (
          <p className="pn-comm__notice" data-testid="thread-disclaimer">
            {t.unverifiedNotice}
          </p>
        ) : null}

        {post.isOwn && post.state !== "published" ? (
          <p className={`pn-comm__status pn-comm__status--${post.state}`} role="status" data-testid="thread-state">
            {t.stateLine(stateLabel(post.state, t), stateHint(post.state, "post", t))}
          </p>
        ) : null}
        {latest && latest.state === "rejected" ? (
          <AppealBox targetType="post_version" targetId={latest.id} appeal={latest.appeal} onSent={refresh} />
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
              aria-disabled={busy.has("helpful") || undefined}
              onClick={() =>
                void run("helpful", async () => {
                  const r = await toggleHelpful("post", post.id);
                  if (r.ok) patchPost((now) => ({ viewerHelpful: r.data.active, helpfulCount: r.data.count ?? now.helpfulCount }));
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
              aria-disabled={busy.has("bookmark") || undefined}
              onClick={() =>
                void run("bookmark", async () => {
                  const r = await toggleSaved(post.id);
                  if (r.ok) patchPost(() => ({ viewerBookmarked: r.data.active }));
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
              <button type="button" className="pn-btn pn-btn--secondary pn-comm__small pn-comm__danger" aria-disabled={busy.has(`delete-${post.id}`) || undefined} onClick={() => askDelete("post", post.id)} data-testid="thread-delete">
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
                  aria-disabled={busy.has(`block-${post.id}`) || undefined}
                  onClick={() => askBlock("post", post.id)}
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
          <h3 ref={commentsRef} tabIndex={-1} className="pn-comm__panel-title">{t.commentsLabel}</h3>
          {comments.length === 0 ? <p className="pn-comm__muted">{t.noComments}</p> : null}
          {comments.length > 0 ? (
            <CommentList
              comments={comments}
              signedIn={signedIn}
              busy={busy}
              replyTo={replyTo}
              onReply={(id) => {
                if (replyDraft.current && id !== replyTo) return setNote(t.replyDraftOpen);
                setReplyTo(id);
              }}
              onHelpful={(c) =>
                void run("c-" + c.id, async () => {
                  const r = await toggleHelpful("comment", c.id);
                  if (r.ok) refresh();
                  return r.ok ? { ok: true as const } : r;
                })
              }
              onReport={(c) => openReport("comment", c.id)}
              onBlock={(c) => askBlock("comment", c.id)}
              onDelete={(c) => askDelete("comment", c.id)}
              report={report?.type === "comment" ? report : null}
              closeReport={closeReport}
              onAppealed={refresh}
              composer={(parentId) => (
                <CommentComposer
                  postId={post.id}
                  parentId={parentId}
                  needGuidelines={guidelinesOk === false}
                  onSent={(state) => {
                    const show = () => {
                      setNote(null);
                      setCommentSent(state);
                    };
                    if (parentId) closeReply(parentId, show);
                    else show();
                    refresh();
                  }}
                  onCancel={parentId ? () => closeReply(parentId) : undefined}
                  onDraft={parentId ? (has) => (replyDraft.current = has) : undefined}
                />
              )}
            />
          ) : null}

          <Live ref={commentSentRef} tabIndex={-1} className={`pn-comm__status pn-comm__status--${commentSent?.state}`} data-testid="comment-sent">
            {commentSent ? (
              <span key={commentSent.n}>
                {commentSent.state === "pending"
                  ? t.commentPending
                  : commentSent.state === "rejected"
                    ? t.commentRejected
                    : t.commentPosted}
              </span>
            ) : null}
          </Live>

          {authStatus === "signedOut" ? <SignInPrompt text={t.signInComment} /> : null}
          {authStatus === "unknown" ? <SignInUnknown look="community" onRetry={() => void recheckAuth()} busy={recheckingAuth} /> : null}
          {signedIn ? (
            // Hidden, not removed, while a reply is open: what was typed here is still there after.
            <div className="pn-comm__panel" hidden={replyTo !== null}>
              <h4 className="pn-comm__panel-title">{t.addComment}</h4>
              <CommentComposer
                postId={post.id}
                parentId={null}
                needGuidelines={guidelinesOk === false}
                onSent={(state) => {
                  setNote(null);
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
          if (target.type === "post") void run(`delete-${target.id}`, () => removePost(target.id), () => router.replace("/app/community"));
          else void run(`delete-${target.id}`, () => removeComment(target.id), () => refreshThen(() => commentsRef.current));
        }}
      >
        <p>{t.deleteBody}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmBlock !== null}
        title={t.blockTitle}
        confirmLabel={t.block}
        testId="block-confirm"
        tone="danger"
        onCancel={() => setConfirmBlock(null)}
        onConfirm={() => {
          const target = confirmBlock;
          setConfirmBlock(null);
          if (!target) return;
          if (target.type === "post") void run(`block-${target.id}`, () => blockPerson("post", target.id), () => router.replace("/app/community"));
          else void run(`block-${target.id}`, () => blockPerson("comment", target.id), () => refreshThen(() => commentsRef.current));
        }}
      >
        <p>{t.blockBody}</p>
      </ConfirmDialog>
    </div>
  );
}

type ListProps = {
  comments: CommentDto[];
  signedIn: boolean;
  busy: ReadonlySet<string>;
  replyTo: string | null;
  onReply: (id: string | null) => void;
  onHelpful: (c: CommentDto) => void;
  onReport: (c: CommentDto) => void;
  onBlock: (c: CommentDto) => void;
  onDelete: (c: CommentDto) => void;
  report: { type: TargetType; id: string } | null;
  closeReport: () => void;
  onAppealed: () => void;
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
          {c.state === "rejected" && c.isOwn ? <AppealBox targetType="comment" targetId={c.id} appeal={c.appeal} onSent={props.onAppealed} /> : null}
          <div className="pn-comm__row">
            {c.state === "published" ? (
              props.signedIn && !c.isOwn ? (
                <button
                  type="button"
                  className="pn-btn pn-btn--secondary pn-comm__small"
                  aria-pressed={c.viewerHelpful}
                  aria-disabled={props.busy.has(`c-${c.id}`) || undefined}
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
                id={`reply-${c.id}`}
                onClick={() => props.onReply(c.id)}
                aria-expanded={props.replyTo === c.id}
                data-testid="comment-reply"
              >
                {t.reply}
              </button>
            ) : null}
            {c.isOwn ? (
              <button type="button" className="pn-btn pn-btn--secondary pn-comm__small pn-comm__danger" aria-disabled={props.busy.has(`delete-${c.id}`) || undefined} onClick={() => props.onDelete(c)}>
                {t.delete}
              </button>
            ) : props.signedIn && c.state === "published" ? (
              <details className="pn-comm__more">
                <summary>{t.more}</summary>
                <div className="pn-comm__row">
                  <button type="button" className="pn-btn pn-btn--secondary pn-comm__small" onClick={() => props.onReport(c)}>
                    {t.report}
                  </button>
                  <button type="button" className="pn-btn pn-btn--secondary pn-comm__small" aria-disabled={props.busy.has(`block-${c.id}`) || undefined} onClick={() => props.onBlock(c)}>
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
  onDraft,
}: {
  postId: string;
  parentId: string | null;
  needGuidelines: boolean;
  onSent: (state: "published" | "pending" | "rejected") => void;
  onCancel?: () => void;
  onDraft?: (has: boolean) => void;
}) {
  const tt = useT();
  const t = tt.community;
  const uid = useId();
  const [text, setText] = useState("");
  const [ack, setAck] = useState(false);
  const { error, errorProps, fail, clear, edited, field: fieldProps } = useFieldError();
  const [sending, setSending] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const field = useRef<HTMLTextAreaElement>(null);
  const textId = `${uid}-c`;
  const ackId = `${uid}-ack`;

  useEffect(() => {
    if (parentId) field.current?.focus();
  }, [parentId]);

  const send = async () => {
    if (sending) return;
    const problem = validateComment(text, tt);
    if (problem) return fail(problem, textId);
    if (needGuidelines && !ack) return fail(t.tickGuidelines, ackId);
    setSending(true);
    clear();
    const r = await submitComment(postId, {
      clientRequestId: requestId,
      body: text.trim(),
      ...(parentId ? { parentCommentId: parentId } : {}),
      guidelinesAccepted: needGuidelines ? ack : true,
    });
    setSending(false);
    if (!r.ok) return fail(apiText(r.message, t.api));
    setText("");
    setRequestId(crypto.randomUUID());
    onSent(r.data.comment.state);
  };

  return (
    <div className="pn-comm__form">
      <div className="pn-comm__field">
        <label htmlFor={textId} className="pn-comm__label">
          {parentId ? t.yourReply : t.yourComment}
        </label>
        <textarea
          ref={field}
          {...fieldProps(textId)}
          className="pn-comm__input pn-comm__textarea"
          rows={3}
          maxLength={COMMENT_MAX}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onDraft?.(e.target.value.trim().length > 0);
            edited(textId);
          }}
        />
        <span className="pn-comm__count">
          {tt.forms.count(text.trim().length, COMMENT_MAX)}
        </span>
      </div>
      {needGuidelines ? <GuidelinesAck id={`${uid}-g`} checked={ack} field={fieldProps(ackId)} onChange={(v) => { setAck(v); edited(ackId); }} /> : null}
      {error ? (
        <p {...errorProps} className="pn-comm__error">
          {error}
        </p>
      ) : null}
      <div className="pn-comm__row">
        <button type="button" className="pn-btn pn-btn--primary pn-comm__small" onClick={() => void send()} aria-disabled={sending || undefined} data-testid="comment-send">
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
  const { error, errorProps, fail, clear, edited, field: fieldProps } = useFieldError();
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const reasonId = `${uid}-reasons`;

  useEffect(() => {
    first.current?.focus();
  }, []);

  if (done) {
    return (
      <div className="pn-comm__panel" data-testid="report-done">
        <p ref={doneRef} tabIndex={-1} className="pn-comm__status" role="status">
          {t.reportDone}
        </p>
        <button type="button" className="pn-btn pn-btn--secondary pn-comm__small" onClick={onDone}>
          {t.close}
        </button>
      </div>
    );
  }

  const send = async () => {
    if (sending) return;
    if (!reason) return fail(t.chooseReason, reasonId);
    setSending(true);
    clear();
    const r = await reportPost(target.type, target.id, reason, noteText.trim() || undefined);
    setSending(false);
    if (r.ok) updateThenFocus(() => setDone(true), () => doneRef.current);
    else fail(apiText(r.message, t.api));
  };

  return (
    <fieldset className="pn-comm__panel" data-testid="report-form">
      <legend className="pn-comm__panel-title">{target.type === "post" ? t.reportPost : t.reportComment}</legend>
      <div role="radiogroup" aria-label={t.reason} {...fieldProps(reasonId)}>
        {reportReasonsIn(t).map((r, i) => (
          <label key={r.value} className="pn-comm__option">
            <input ref={i === 0 ? first : undefined} type="radio" name={`${uid}-reason`} value={r.value} checked={reason === r.value} onChange={() => { setReason(r.value); edited(reasonId); }} />
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
        <p {...errorProps} className="pn-comm__error">
          {error}
        </p>
      ) : null}
      <div className="pn-comm__row">
        <button type="button" className="pn-btn pn-btn--primary pn-comm__small" onClick={() => void send()} aria-disabled={sending || undefined} data-testid="report-send">
          {sending ? tt.forms.sending : t.sendReport}
        </button>
        <button type="button" className="pn-btn pn-btn--secondary pn-comm__small" onClick={onDone}>
          {tt.kit.cancel}
        </button>
      </div>
    </fieldset>
  );
}

/**
 * Asking for another review of a decision not to publish (N6): once per item; a different person
 * than the one who decided reviews it. Once asked, only the state is shown.
 */
function AppealBox({ targetType, targetId, appeal, onSent }: { targetType: AppealTarget; targetId: string; appeal: AppealState | null; onSent: () => void }) {
  const tt = useT();
  const t = tt.community;
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { error, errorProps, fail, clear, edited, field: fieldProps } = useFieldError();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const noteId = `${uid}-a`;
  const stateRef = useRef<HTMLParagraphElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);

  if (appeal || sent) {
    return (
      <p ref={stateRef} tabIndex={-1} className="pn-comm__status" role="status" data-testid="appeal-state">
        {sent && !appeal ? t.appeal.sent : t.appeal.states[appeal ?? "open"]}
      </p>
    );
  }
  if (!open) {
    return (
      <div className="pn-comm__row">
        <button ref={openRef} type="button" className="pn-btn pn-btn--secondary pn-comm__small" onClick={() => updateThenFocus(() => setOpen(true), () => document.getElementById(noteId))} data-testid="appeal-open">
          {t.appeal.ask}
        </button>
      </div>
    );
  }
  const send = async () => {
    if (sending) return;
    const n = text.trim().length;
    if (n < APPEAL_NOTE_MIN) return fail(tt.forms.minChars(APPEAL_NOTE_MIN), noteId);
    setSending(true);
    clear();
    const r = await submitAppeal({ targetType, targetId, note: text.trim() });
    setSending(false);
    if (r.ok) {
      updateThenFocus(() => setSent(true), () => stateRef.current);
      onSent();
    } else fail(r.reason === "conflict" ? t.appeal.already : r.reason === "failed" ? t.appeal.failed : apiText(r.message, t.api));
  };
  return (
    <div className="pn-comm__panel" data-testid="appeal-form">
      <div className="pn-comm__field">
        <label htmlFor={noteId} className="pn-comm__label">
          {t.appeal.noteLabel}
        </label>
        <textarea
          {...fieldProps(noteId, `${uid}-ah`)}
          className="pn-comm__input pn-comm__textarea"
          rows={3}
          maxLength={APPEAL_NOTE_MAX}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            edited(noteId);
          }}
        />
        <span id={`${uid}-ah`} className="pn-comm__hint">
          {t.appeal.noteHint(APPEAL_NOTE_MIN)}
        </span>
      </div>
      {error ? (
        <p {...errorProps} className="pn-comm__error">
          {error}
        </p>
      ) : null}
      <div className="pn-comm__row">
        <button type="button" className="pn-btn pn-btn--primary pn-comm__small" onClick={() => void send()} aria-disabled={sending || undefined} data-testid="appeal-send">
          {sending ? tt.forms.sending : t.appeal.send}
        </button>
        <button type="button" className="pn-btn pn-btn--secondary pn-comm__small" onClick={() => updateThenFocus(() => setOpen(false), () => openRef.current)}>
          {t.appeal.cancel}
        </button>
      </div>
    </div>
  );
}
