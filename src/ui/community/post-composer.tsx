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
import { uploadPhoto } from "@/client/corrections/api";
import {
  BODY_MAX,
  MAX_PHOTOS,
  MAX_TAGS,
  parseTagInput,
  TITLE_MAX,
  validateBody,
  validateTitle,
  routeCodeSchema,
} from "@/domain/community/schemas";
import { stateHint, stateLabel, type ContentState } from "@/domain/community/status";
import { topicsIn, type CommunityTopic } from "@/domain/community/topics";
import { en, translated } from "@/i18n/dict";
import { useT } from "@/i18n/provider";
import { GuidelinesAck, SignInPrompt } from "./parts";

type Props = { mode: "new" } | { mode: "edit"; postId: string };
type Step = "guidelines" | "write";
type Sent = { id: string; state: ContentState; isEdit: boolean; visibleToOthers: boolean };

export function PostComposer(props: Props) {
  const tt = useT();
  const t = tt.community;
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
  // N6: photos wait in the private bucket until a moderator approves each one.
  const [photos, setPhotos] = useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
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
      if (!r.data.post.isOwn || !draft) return setLoadError(en.community.onlyAuthor);
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
    if (!ackChecked) return setError(t.tickGuidelines);
    setError(null);
    setStep("write");
  };

  const onPickPhoto = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (photos.length >= MAX_PHOTOS) return setPhotoNote(t.photos.max(MAX_PHOTOS));
    setUploading(true);
    setPhotoNote(null);
    const result = await uploadPhoto(file, "community_photo");
    setUploading(false);
    if (result.ok) setPhotos((p) => [...p, { id: result.mediaId, name: file.name.slice(0, 60) }]);
    else setPhotoNote(result.message === en.report.api.photoType ? t.photos.type : t.photos.failed);
  };

  const onSend = async () => {
    if (!user) return;
    const tags = parseTagInput(tagText);
    const problem =
      (props.mode === "new" && !topic ? t.chooseTopic : null) ??
      validateTitle(title, tt) ??
      validateBody(body, tt) ??
      (tags.invalid.length > 0 ? t.badTags(tags.invalid.join(", ")) : null) ??
      (tags.tags.length > MAX_TAGS ? t.maxTags(MAX_TAGS) : null) ??
      (route.trim() && !routeCodeSchema.safeParse(route).success ? t.badRoute : null);
    if (problem) return setError(problem);
    setSending(true);
    setError(null);
    const common = { clientRequestId: requestId, title: title.trim(), body: body.trim(), tags: tags.tags, guidelinesAccepted: accepted === false ? ackChecked : true };
    const result =
      props.mode === "edit"
        ? await submitEdit(props.postId, common)
        : await submitPost({
            ...common,
            topic: topic as CommunityTopic,
            ...(route.trim() ? { routeCode: route.trim() } : {}),
            photoIds: photos.map((p) => p.id),
          });
    setSending(false);
    if (result.ok) setSent(result.data.post);
    else setError(translated(result.message, en.community.api, t.api));
  };

  const heading1 = props.mode === "edit" ? t.editHeading : t.newPost;

  if (sent) {
    const edit = sent.isEdit;
    return (
      <div className="pn-comm" onKeyDown={onKeyDown} data-testid="composer-done">
        <h2 ref={heading} tabIndex={-1} className="pn-comm__h2">
          {edit ? t.editSent : t.postSent}
        </h2>
        <p className={`pn-comm__status pn-comm__status--${sent.state}`} role="status" data-testid="composer-state">
          {t.stateLine(stateLabel(sent.state, t), stateHint(sent.state, edit ? "edit" : "post", t))}
        </p>
        {sent.state === "pending" ? (
          <p className="pn-comm__muted">{t.pendingNote}</p>
        ) : null}
        <div className="pn-comm__nav">
          <Link href="/app/community" className="pn-btn pn-btn--secondary pn-comm__action">
            {t.backToCommunity}
          </Link>
          <Link href={`/app/community/${sent.id}`} className="pn-btn pn-btn--primary pn-comm__action" data-testid="composer-view">
            {t.viewPost}
          </Link>
        </div>
      </div>
    );
  }

  if (!authLoading && !user) {
    return (
      <div className="pn-comm" data-testid="composer-guest">
        <h2 className="pn-comm__h2">{heading1}</h2>
        <SignInPrompt text={props.mode === "edit" ? t.signInEdit : t.signInWrite} />
      </div>
    );
  }
  if (authLoading || accepted === null || !draftReady) {
    return (
      <div className="pn-comm" data-testid="composer-loading">
        {loadError ? (
          <p className="pn-comm__error" role="alert">
            {translated(translated(loadError, en.community.api, t.api), en.community, t)}
          </p>
        ) : (
          <p className="pn-comm__muted">{tt.forms.loading}</p>
        )}
      </div>
    );
  }

  return (
    <div className="pn-comm" onKeyDown={onKeyDown} data-testid="composer">
      <h2 ref={heading} tabIndex={-1} className="pn-comm__h2">
        {step === "guidelines" ? t.beforePost : heading1}
      </h2>

      {step === "guidelines" ? (
        <div className="pn-comm__form">
          <GuidelinesAck id={`${uid}-g`} checked={ackChecked} onChange={(v) => { setAckChecked(v); setError(null); }} />
        </div>
      ) : (
        <div className="pn-comm__form">
          {props.mode === "new" ? (
            <fieldset className="pn-comm__field">
              <legend className="pn-comm__label">{t.topicGroup}</legend>
              <div className="pn-group" role="radiogroup" aria-label={t.topicGroup}>
                {topicsIn(t).map((x) => (
                  <label key={x.value} className="pn-comm__option">
                    <input type="radio" name={`${uid}-topic`} value={x.value} checked={topic === x.value} onChange={() => { setTopic(x.value); setError(null); }} />
                    <span className="pn-comm__option-text">
                      <span className="pn-comm__option-label">{x.label}</span>
                      <span className="pn-comm__option-hint">{x.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <div className="pn-comm__field">
            <label htmlFor={`${uid}-title`} className="pn-comm__label">
              {t.titleLabel}
            </label>
            <input id={`${uid}-title`} className="pn-comm__input" maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" />
          </div>

          <div className="pn-comm__field">
            <label htmlFor={`${uid}-body`} className="pn-comm__label">
              {t.bodyLabel}
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
              {tt.forms.count(body.trim().length, BODY_MAX)}
            </span>
            <span id={`${uid}-driver`} className="pn-comm__hint">
              {t.driverNotice}
            </span>
          </div>

          <div className="pn-comm__field">
            <label htmlFor={`${uid}-tags`} className="pn-comm__label">
              {t.tagsLabel(MAX_TAGS)}
            </label>
            <input id={`${uid}-tags`} className="pn-comm__input" value={tagText} onChange={(e) => setTagText(e.target.value)} autoComplete="off" placeholder={t.tagsPlaceholder} />
          </div>

          {props.mode === "new" ? (
            <div className="pn-comm__field">
              <label htmlFor={`${uid}-route`} className="pn-comm__label">
                {t.routeLabel}
              </label>
              <input id={`${uid}-route`} className="pn-comm__input" maxLength={16} value={route} onChange={(e) => setRoute(e.target.value)} autoComplete="off" placeholder="R4" />
            </div>
          ) : null}

          {props.mode === "new" ? (
            <div className="pn-comm__field">
              <span className="pn-comm__label">{t.photos.label}</span>
              {photos.length > 0 ? (
                <ul className="pn-comm__photo-list" data-testid="composer-photos">
                  {photos.map((p) => (
                    <li key={p.id}>
                      <span className="pn-comm__photo-name">{p.name}</span>
                      <button
                        type="button"
                        className="pn-btn pn-btn--secondary pn-comm__small"
                        onClick={() => setPhotos((all) => all.filter((x) => x.id !== p.id))}
                        aria-label={t.photos.remove(p.name)}
                      >
                        {tt.forms.remove}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {photos.length < MAX_PHOTOS ? (
                <>
                  <input
                    id={`${uid}-photo`}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="pn-comm__file"
                    disabled={uploading}
                    data-testid="composer-photo-input"
                    onChange={(e) => {
                      void onPickPhoto(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <label htmlFor={`${uid}-photo`} className="pn-btn pn-btn--secondary pn-comm__small" aria-disabled={uploading}>
                    {uploading ? t.photos.uploading : t.photos.add}
                  </label>
                </>
              ) : null}
              <span className="pn-comm__hint">{t.photos.hint(MAX_PHOTOS)}</span>
              {photoNote ? (
                <p className="pn-comm__hint" role="status">
                  {photoNote}
                </p>
              ) : null}
            </div>
          ) : null}

          {props.mode === "edit" ? (
            <p className="pn-comm__hint">{t.editHint}</p>
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
            {tt.forms.back}
          </button>
        ) : null}
        {step === "guidelines" ? (
          <button type="button" className="pn-btn pn-btn--primary pn-comm__action" onClick={onContinue} data-testid="composer-continue">
            {tt.forms.continue}
          </button>
        ) : (
          <button type="button" className="pn-btn pn-btn--primary pn-comm__action" onClick={() => void onSend()} disabled={sending} data-testid="composer-send">
            {sending ? tt.forms.sending : props.mode === "edit" ? t.sendEdit : t.post}
          </button>
        )}
      </div>
    </div>
  );
}
