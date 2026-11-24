"use client";

// Community feed (S17, F-D2): published posts, filtered by topic, search and tag. Guests read;
// writing, saving and "My posts" need an account. Everything here was written by other commuters
// and is not verified by Lunad; the notice says so once, under the list.

import "@/ui/kit/styles";
import "./community.css";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useAuthSession } from "@/client/auth/use-auth-session";
import { fetchCommunityMe, fetchFeed, toggleSaved, unblockPerson } from "@/client/community/api";
import { SEARCH_MAX, SEARCH_MIN, type FeedScope, type PostSummary } from "@/domain/community/schemas";
import { topicsIn, type CommunityTopic } from "@/domain/community/topics";
import { en, translated } from "@/i18n/dict";
import { useT } from "@/i18n/provider";
import { updateThenFocus, useFieldError } from "@/ui/report/form-a11y";
import { PostBadges, useFormatDate } from "./parts";

type Result = { key: string; ok: boolean; posts: PostSummary[]; next: number | null; message: string | null };

const SCOPES: readonly FeedScope[] = ["all", "mine", "saved"];

export function CommunityFeed() {
  const tt = useT();
  const t = tt.community;
  const apiText = (message: string) => translated(message, en.community.api, t.api);
  const formatDate = useFormatDate();
  const uid = useId();
  const { user, loading: authLoading } = useAuthSession();
  const signedIn = Boolean(user);
  const [topic, setTopic] = useState<CommunityTopic | null>(null);
  const [scope, setScope] = useState<FeedScope>("all");
  const [tag, setTag] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState("");
  const searchError = useFieldError();
  const searchId = `${uid}-q`;
  // Where focus goes when the control that held it leaves with a filter or the old results.
  const results = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const thenResults = (update: () => void) => updateThenFocus(update, () => results.current);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const effectiveScope: FeedScope = signedIn ? scope : "all";
  const key = JSON.stringify([signedIn, topic, effectiveScope, tag, q, reload]);
  const loading = authLoading || result?.key !== key;

  useEffect(() => {
    if (authLoading) return undefined;
    let cancelled = false;
    void fetchFeed({ topic, scope: effectiveScope, tag: tag ?? undefined, q: q || undefined }, signedIn).then((r) => {
      if (cancelled) return;
      setResult(
        r.ok
          ? { key, ok: true, posts: r.data.posts, next: r.data.nextCursor, message: null }
          : { key, ok: false, posts: [], next: null, message: r.message },
      );
    });
    return () => {
      cancelled = true;
    };
    // `key` already encodes every input of the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, authLoading]);

  const loadMore = async () => {
    if (!result?.next || loadingMore) return;
    const shown = result.posts.length;
    setLoadingMore(true);
    setNote(null);
    const r = await fetchFeed({ topic, scope: effectiveScope, tag: tag ?? undefined, q: q || undefined, cursor: result.next }, signedIn);
    setLoadingMore(false);
    if (!r.ok) return setNote(apiText(r.message));
    // The last page takes the button away: on to the first post it brought.
    updateThenFocus(
      () => setResult((prev) => (prev && prev.key === key ? { ...prev, posts: [...prev.posts, ...r.data.posts], next: r.data.nextCursor } : prev)),
      () => list.current?.children[shown]?.querySelector("a") ?? results.current,
    );
  };

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (text.length > 0 && text.length < SEARCH_MIN) return searchError.fail(t.searchMin(SEARCH_MIN), searchId);
    searchError.clear();
    setQ(text);
  };

  const onSave = async (post: PostSummary) => {
    setNote(null);
    const r = await toggleSaved(post.id);
    if (!r.ok) return setNote(apiText(r.message));
    setResult((prev) =>
      prev ? { ...prev, posts: prev.posts.map((p) => (p.id === post.id ? { ...p, viewerBookmarked: r.data.active } : p)) } : prev,
    );
  };

  const filtering = topic !== null || tag !== null || q !== "";

  return (
    <div className="pn-comm" data-testid="community-feed">
      <div className="pn-comm__bar">
        <Link href="/app/community/new" className="pn-btn pn-btn--primary pn-comm__action" data-testid="community-new">
          {t.newPost}
        </Link>
      </div>

      <form className="pn-comm__search" role="search" onSubmit={onSearch} aria-label={t.searchLabel}>
        <label htmlFor={searchId} className="sr-only">
          {t.searchLabel}
        </label>
        <input
          {...searchError.field(searchId)}
          type="search"
          className="pn-comm__input"
          placeholder={t.searchLabel}
          maxLength={SEARCH_MAX}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            searchError.edited(searchId);
          }}
          autoComplete="off"
        />
        <button type="submit" className="pn-btn pn-btn--secondary pn-comm__small">
          {t.search}
        </button>
      </form>
      {searchError.error ? (
        <p id={searchError.errorId} className="pn-comm__hint" role="status">
          {searchError.error}
        </p>
      ) : null}

      <div className="pn-comm__chips" role="group" aria-label={t.topicGroup}>
        <button type="button" className="pn-comm__chip" aria-pressed={topic === null} onClick={() => setTopic(null)}>
          {t.allTopics}
        </button>
        {topicsIn(t).map((x) => (
          <button key={x.value} type="button" className="pn-comm__chip" aria-pressed={topic === x.value} onClick={() => setTopic(x.value)}>
            {x.label}
          </button>
        ))}
      </div>

      {signedIn ? (
        <div className="pn-comm__chips" role="group" aria-label={t.showGroup}>
          {SCOPES.map((s) => (
            <button key={s} type="button" className="pn-comm__chip" aria-pressed={scope === s} onClick={() => setScope(s)}>
              {t.scopes[s]}
            </button>
          ))}
        </div>
      ) : null}

      {tag || q ? (
        <div className="pn-comm__chips" aria-label={t.activeFilters}>
          {tag ? (
            <button type="button" className="pn-comm__chip" onClick={() => thenResults(() => setTag(null))} aria-label={t.removeTag(tag)}>
              {t.tagChip(tag)}
            </button>
          ) : null}
          {q ? (
            <button
              type="button"
              className="pn-comm__chip"
              onClick={() =>
                thenResults(() => {
                  setQ("");
                  setDraft("");
                })
              }
              aria-label={t.clearSearch(q)}
            >
              {t.searchChip(q)}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Always in the page, so what the list becomes (loading, how many, none, an error) is announced. */}
      <div ref={results} tabIndex={-1} aria-live="polite" className="pn-comm__live" data-testid="community-results">
        {loading ? (
          <p className="pn-comm__muted" data-testid="community-loading">
            {t.loadingPosts}
          </p>
        ) : null}
        {!loading && result && !result.ok ? (
          <div className="pn-comm__panel pn-comm__panel--error" data-testid="community-error">
            <p className="pn-comm__body">{result.message ? apiText(result.message) : t.loadFailed}</p>
            <button type="button" className="pn-btn pn-btn--secondary pn-comm__small" onClick={() => thenResults(() => setReload((n) => n + 1))}>
              {tt.forms.tryAgain}
            </button>
          </div>
        ) : null}
        {!loading && result?.ok && result.posts.length === 0 ? (
          <p className="pn-comm__empty" data-testid="community-empty">
            {effectiveScope === "mine"
              ? t.emptyMine
              : effectiveScope === "saved"
                ? t.emptySaved
                : filtering
                  ? t.emptyFiltered
                  : t.emptyAll}
          </p>
        ) : null}
        {!loading && result?.ok && result.posts.length > 0 ? <p className="sr-only">{t.postsShown(result.posts.length)}</p> : null}
      </div>

      {!loading && result?.ok && result.posts.length > 0 ? (
        <ul ref={list} className="pn-comm__list" data-testid="community-list">
          {result.posts.map((p) => (
            <li key={p.id} className="pn-comm__card" data-testid="community-post">
              <PostBadges post={p} />
              <h2 className="pn-comm__post-title">
                <Link href={`/app/community/${p.id}`} className="pn-comm__link">
                  {p.title}
                </Link>
              </h2>
              <p className="pn-comm__excerpt">{p.excerpt}</p>
              {p.tags.length > 0 ? (
                <div className="pn-comm__tags">
                  {p.tags.map((tag) => (
                    <button key={tag} type="button" className="pn-comm__tag" onClick={() => thenResults(() => setTag(tag))} aria-label={t.showTagged(tag)}>
                      #{tag}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="pn-comm__meta">
                <span>{p.isOwn ? t.you : p.authorHandle}</span>
                <span>{formatDate(p.createdAt)}</span>
                <span>{t.helpfulCount(p.helpfulCount)}</span>
                <span>{t.comments(p.commentCount)}</span>
              </div>
              {signedIn && p.state === "published" ? (
                <div className="pn-comm__row">
                  <button
                    type="button"
                    className="pn-btn pn-btn--secondary pn-comm__small"
                    aria-pressed={p.viewerBookmarked}
                    onClick={() => void onSave(p)}
                    data-testid="community-bookmark"
                  >
                    {p.viewerBookmarked ? t.saved : t.save}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {note ? (
        <p className="pn-comm__error" role="alert">
          {note}
        </p>
      ) : null}

      {!loading && result?.next ? (
        <button type="button" className="pn-btn pn-btn--secondary pn-comm__action" onClick={() => void loadMore()} aria-disabled={loadingMore || undefined} data-testid="community-more">
          {loadingMore ? tt.forms.loading : t.showMore}
        </button>
      ) : null}

      <p className="pn-comm__notice" data-testid="community-disclaimer">
        {t.feedNotice}
      </p>

      {signedIn ? <BlockedPeople onChanged={() => setReload((n) => n + 1)} onEmpty={() => results.current} /> : null}
    </div>
  );
}

/** The people this commuter blocked, with a way to undo it. Their posts and comments stay hidden until then. */
function BlockedPeople({ onChanged, onEmpty }: { onChanged: () => void; onEmpty: () => HTMLElement | null }) {
  const t = useT().community;
  const [people, setPeople] = useState<{ id: string; handle: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useRef<HTMLUListElement>(null);

  const unblock = async (id: string, i: number) => {
    const r = await unblockPerson(id);
    if (!r.ok) return setError(translated(r.message, en.community.api, t.api));
    const now = await fetchCommunityMe();
    if (now.ok) {
      updateThenFocus(
        () => setPeople(now.data.blocked),
        () => {
          const left = list.current?.querySelectorAll("button");
          return left?.[Math.min(i, left.length - 1)] ?? onEmpty();
        },
      );
    } else setError(now.message);
    onChanged();
  };
  useEffect(() => {
    let cancelled = false;
    void fetchCommunityMe().then((r) => {
      if (cancelled) return;
      if (r.ok) setPeople(r.data.blocked);
      else setError(r.message);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!people || people.length === 0) return null;
  return (
    <details className="pn-comm__more" data-testid="blocked-people">
      <summary>{t.blocked(people.length)}</summary>
      <ul ref={list} className="pn-comm__history">
        {people.map((p, i) => (
          <li key={p.id}>
            <span>{p.handle}</span>
            <button
              type="button"
              className="pn-btn pn-btn--secondary pn-comm__small"
              onClick={() => void unblock(p.id, i)}
              aria-label={t.unblockLabel(p.handle)}
            >
              {t.unblock}
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p className="pn-comm__error" role="alert">
          {translated(error, en.community.api, t.api)}
        </p>
      ) : null}
    </details>
  );
}
