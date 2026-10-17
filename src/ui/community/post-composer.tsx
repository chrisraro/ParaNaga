"use client";

// New post and edit (S17, F-D2): 1 Community guidelines (only until they were accepted) ->
// 2 Write -> sent. Guests can read the screen; writing needs an account. A post lands as
// "Awaiting review" unless a person or a confident auto-publish has cleared it; an edit becomes a
// new version while the earlier published one stays visible.
//
// Focus moves to the step heading on every step change. Escape steps back one step (the page's own
// Escape-to-close only runs when the key is not already handled here).

import "@/ui/kit/styles";
import "./community.css";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useAuthSession } from "@/client/auth/use-auth-session";
import { fetchCommunityMe, fetchPost, submitEdit, submitPost } from "@/client/community/api";
import { DRIVER_NOTICE } from "@/domain/community/guidelines";
import {
  BODY_MAX,
  MAX_TAGS,
  parseTagInput,
  TITLE_MAX,
  validateBody,
  validateTitle,
  routeCodeSchema,
} from "@/domain/community/schemas";
import { stateHint, stateLabel, type ContentState } from "@/domain/community/status";
import { COMMUNITY_TOPICS, type CommunityTopic } from "@/domain/community/topics";
import { GuidelinesAck, SignInPrompt } from "./parts";

type Props = { mode: "new" } | { mode: "edit"; postId: string };
type Step = "guidelines" | "write";
type Sent = { id: string; state: ContentState; isEdit: boolean; visibleToOthers: boolean };

export function PostComposer(props: Props) {
  const uid = useId();
  const { user, loading: authLoading } = useAuthSession();
  const editId = props.mode === "edit" ? props.postId : null;

  const [accepted, setAccepted] = useState<boolean | null>(null); // null until /me answered
  const [ackChecked, setAckChecked] = useState(false);
  const [step, setStep] = useState<Step>("write");
  const [topic, setTopic] = useState<CommunityTopic | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tagText, setTagText] = useState("");
  const [route, setRoute] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(props.mode === "new");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  const heading = useRef<HTMLHeadingElement>(null);

  // Has this person accepted the guidelines? If not, they come first.
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    void fetchCommunityMe().then((r) => {
      if (cancelled) return;
      const ok = r.ok ? r.data.guidelinesAccepted : false;
      setAccepted(ok);
      if (!ok) {
        setStep("guidelines");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Edit: start from the author's latest version.
  useEffect(() => {
    if (!editId || !user) return undefined;
    let cancelled = false;
    void fetchPost(editId, true).then((r) => {
      if (cancelled) return;
      if (!r.ok) return setLoadError(r.message);
      const draft = r.data.post.editDraft;
      if (!r.data.post.isOwn || !draft) return setLoadError("Only the author can edit this post.");
      setTitle(draft.title);
      setBody(draft.body);
      setTagText(draft.tags.join(" "));
      setDraftReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [editId, user]);

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step, sent]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || sent) return;
    if (step === "write" && accepted === false) {
      e.preventDefault();
      setError(null);
      setStep("guidelines");
    }
  };

  const onContinue = () => {
    if (!ackChecked) return setError("Tick the box to confirm you have read the guidelines.");
    setError(null);
    setStep("write");
  };

  const onSend = async () => {
    if (!user) return;
    const tags = parseTagInput(tagText);
    const problem =
      (props.mode === "new" && !topic ? "Choose a topic." : null) ??
      validateTitle(title) ??
      validateBody(body) ??
      (tags.invalid.length > 0 ? `These tags are not allowed: ${tags.invalid.join(", ")}. Use letters, numbers and hyphens.` : null) ??
      (tags.tags.length > MAX_TAGS ? `Use at most ${MAX_TAGS} tags.` : null) ??
      (route.trim() && !routeCodeSchema.safeParse(route).success ? "Route codes use letters, numbers and hyphens, like R4 or R8-A." : null);
    if (problem) return setError(problem);
    setSending(true);
    setError(null);
    const common = { clientRequestId: requestId, title: title.trim(), body: body.trim(), tags: tags.tags, guidelinesAccepted: accepted === false ? ackChecked : true };
    const result =
      props.mode === "edit"
        ? await submitEdit(props.postId, common)
        : await submitPost({ ...common, topic: topic as CommunityTopic, ...(route.trim() ? { routeCode: route.trim() } : {}) });
    setSending(false);
    if (result.ok) setSent(result.data.post);
    else setError(result.message);
  };

  const heading1 = props.mode === "edit" ? "Edit your post" : "New post";

  if (sent) {
    const edit = sent.isEdit;
    return (
      <div className="pn-comm" onKeyDown={onKeyDown} data-testid="composer-done">
        <h2 ref={heading} tabIndex={-1} className="pn-comm__h2">
          {edit ? "Edit sent" : "Post sent"}
        </h2>
        <p className={`pn-comm__status pn-comm__status--${sent.state}`} role="status" data-testid="composer-state">
          {stateLabel(sent.state)}. {stateHint(sent.state, edit ? "edit" : "post")}
        </p>
        {sent.state === "pending" ? (
          <p className="pn-comm__muted">A person checks posts before others can read them. You can still open your post from My posts.</p>
        ) : null}
        <div className="pn-comm__nav">
          <Link href="/app/community" className="pn-btn pn-btn--secondary pn-comm__action">
            Back to community
          </Link>
          <Link href={`/app/community/${sent.id}`} className="pn-btn pn-btn--primary pn-comm__action" data-testid="composer-view">
            View post
          </Link>
        </div>
      </div>
    );
  }

  if (!authLoading && !user) {
    return (
      <div className="pn-comm" data-testid="composer-guest">
        <h2 className="pn-comm__h2">{heading1}</h2>
        <SignInPrompt what={props.mode === "edit" ? "edit your post" : "write a post"} />
      </div>
    );
  }
  if (authLoading || accepted === null || !draftReady) {
    return (
      <div className="pn-comm" data-testid="composer-loading">
        {loadError ? (
          <p className="pn-comm__error" role="alert">
            {loadError}
          </p>
        ) : (
          <p className="pn-comm__muted">Loading…</p>
        )}
      </div>
    );
  }

  return (
    <div className="pn-comm" onKeyDown={onKeyDown} data-testid="composer">
      <h2 ref={heading} tabIndex={-1} className="pn-comm__h2">
        {step === "guidelines" ? "Before you post" : heading1}
      </h2>

      {step === "guidelines" ? (
        <div className="pn-comm__form">
          <GuidelinesAck id={`${uid}-g`} checked={ackChecked} onChange={(v) => { setAckChecked(v); setError(null); }} />
        </div>
      ) : (
        <div className="pn-comm__form">
          {props.mode === "new" ? (
            <fieldset className="pn-comm__field">
              <legend className="pn-comm__label">Topic</legend>
              <div className="pn-group" role="radiogroup" aria-label="Topic">
                {COMMUNITY_TOPICS.map((t) => (
                  <label key={t.value} className="pn-comm__option">
                    <input type="radio" name={`${uid}-topic`} value={t.value} checked={topic === t.value} onChange={() => { setTopic(t.value); setError(null); }} />
                    <span className="pn-comm__option-text">
                      <span className="pn-comm__option-label">{t.label}</span>
                      <span className="pn-comm__option-hint">{t.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <div className="pn-comm__field">
            <label htmlFor={`${uid}-title`} className="pn-comm__label">
              Title
            </label>
            <input id={`${uid}-title`} className="pn-comm__input" maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" />
          </div>

          <div className="pn-comm__field">
            <label htmlFor={`${uid}-body`} className="pn-comm__label">
              Your post
            </label>
            <textarea
              id={`${uid}-body`}
              className="pn-comm__input pn-comm__textarea"
              rows={7}
              maxLength={BODY_MAX}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-describedby={`${uid}-count ${uid}-driver`}
            />
            <span id={`${uid}-count`} className="pn-comm__count">
              {body.trim().length} of {BODY_MAX}
            </span>
            <span id={`${uid}-driver`} className="pn-comm__hint">
              {DRIVER_NOTICE}
            </span>
          </div>

          <div className="pn-comm__field">
            <label htmlFor={`${uid}-tags`} className="pn-comm__label">
              Tags (optional, up to {MAX_TAGS})
            </label>
            <input id={`${uid}-tags`} className="pn-comm__input" value={tagText} onChange={(e) => setTagText(e.target.value)} autoComplete="off" placeholder="for example: fares, loop-a" />
          </div>

          {props.mode === "new" ? (
            <div className="pn-comm__field">
              <label htmlFor={`${uid}-route`} className="pn-comm__label">
                Route code (optional)
              </label>
              <input id={`${uid}-route`} className="pn-comm__input" maxLength={16} value={route} onChange={(e) => setRoute(e.target.value)} autoComplete="off" placeholder="R4" />
            </div>
          ) : null}

          {props.mode === "edit" ? (
            <p className="pn-comm__hint">Your edit is checked before it replaces the current version. The current version stays visible until then.</p>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="pn-comm__error" role="alert" data-testid="composer-error">
          {error}
        </p>
      ) : null}

      <div className="pn-comm__nav">
        {step === "write" && accepted === false ? (
          <button type="button" className="pn-btn pn-btn--secondary pn-comm__action" onClick={() => { setError(null); setStep("guidelines"); }}>
            Back
          </button>
        ) : null}
        {step === "guidelines" ? (
          <button type="button" className="pn-btn pn-btn--primary pn-comm__action" onClick={onContinue} data-testid="composer-continue">
            Continue
          </button>
        ) : (
          <button type="button" className="pn-btn pn-btn--primary pn-comm__action" onClick={() => void onSend()} disabled={sending} data-testid="composer-send">
            {sending ? "Sending…" : props.mode === "edit" ? "Send edit" : "Post"}
          </button>
        )}
      </div>
    </div>
  );
}
