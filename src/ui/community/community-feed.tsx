"use client";

// Community feed (S17, F-D2): published posts, filtered by topic, search and tag. Guests read;
// writing, saving and "My posts" need an account. Everything here was written by other commuters
// and is not verified by ParaNaga; the notice says so once, under the list.

import "@/ui/kit/styles";
import "./community.css";

import Link from "next/link";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { useAuthSession } from "@/client/auth/use-auth-session";
import { fetchCommunityMe, fetchFeed, toggleSaved, unblockPerson } from "@/client/community/api";
import { UNVERIFIED_NOTICE } from "@/domain/community/guidelines";
import { SEARCH_MAX, SEARCH_MIN, type FeedScope, type PostSummary } from "@/domain/community/schemas";
import { COMMUNITY_TOPICS, type CommunityTopic } from "@/domain/community/topics";
import { formatDate, PostBadges } from "./parts";

type Result = { key: string; ok: boolean; posts: PostSummary[]; next: number | null; message: string | null };

const SCOPES: { value: FeedScope; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "mine", label: "My posts" },
  { value: "saved", label: "Saved" },
];

export function CommunityFeed() {
  const uid = useId();
  const { user, loading: authLoading } = useAuthSession();
  const signedIn = Boolean(user);
  const [topic, setTopic] = useState<CommunityTopic | null>(null);
  const [scope, setScope] = useState<FeedScope>("all");
  const [tag, setTag] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState("");
  const [searchNote, setSearchNote] = useState<string | null>(null);
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
    if (!result?.next) return;
    setLoadingMore(true);
    setNote(null);
    const r = await fetchFeed({ topic, scope: effectiveScope, tag: tag ?? undefined, q: q || undefined, cursor: result.next }, signedIn);
    setLoadingMore(false);
    if (!r.ok) return setNote(r.message);
    setResult((prev) => (prev && prev.key === key ? { ...prev, posts: [...prev.posts, ...r.data.posts], next: r.data.nextCursor } : prev));
  };

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (text.length > 0 && text.length < SEARCH_MIN) return setSearchNote(`Type at least ${SEARCH_MIN} letters to search.`);
    setSearchNote(null);
    setQ(text);
  };

  const onSave = async (post: PostSummary) => {
    setNote(null);
    const r = await toggleSaved(post.id);
    if (!r.ok) return setNote(r.message);
    setResult((prev) =>
      prev ? { ...prev, posts: prev.posts.map((p) => (p.id === post.id ? { ...p, viewerBookmarked: r.data.active } : p)) } : prev,
    );
  };

  const filtering = topic !== null || tag !== null || q !== "";

  return (
    <div className="pn-comm" data-testid="community-feed">
      <div className="pn-comm__bar">
        <Link href="/app/community/new" className="pn-btn pn-btn--primary pn-comm__action" data-testid="community-new">
          New post
        </Link>
      </div>

      <form className="pn-comm__search" role="search" onSubmit={onSearch} aria-label="Search posts">
        <label htmlFor={`${uid}-q`} className="sr-only">
          Search posts
        </label>
        <input
          id={`${uid}-q`}
          type="search"
          className="pn-comm__input"
          placeholder="Search posts"
          maxLength={SEARCH_MAX}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoComplete="off"
        />
        <button type="submit" className="pn-btn pn-btn--secondary pn-comm__small">
          Search
        </button>
      </form>
      {searchNote ? (
        <p className="pn-comm__hint" role="status">
          {searchNote}
        </p>
      ) : null}

      <div className="pn-comm__chips" role="group" aria-label="Topic">
        <button type="button" className="pn-comm__chip" aria-pressed={topic === null} onClick={() => setTopic(null)}>
          All topics
        </button>
        {COMMUNITY_TOPICS.map((t) => (
          <button key={t.value} type="button" className="pn-comm__chip" aria-pressed={topic === t.value} onClick={() => setTopic(t.value)}>
            {t.label}
          </button>
        ))}
      </div>

      {signedIn ? (
        <div className="pn-comm__chips" role="group" aria-label="Show">
          {SCOPES.map((s) => (
            <button key={s.value} type="button" className="pn-comm__chip" aria-pressed={scope === s.value} onClick={() => setScope(s.value)}>
              {s.label}
            </button>
          ))}
        </div>
      ) : null}

      {tag || q ? (
        <div className="pn-comm__chips" aria-label="Active filters">
          {tag ? (
            <button type="button" className="pn-comm__chip" onClick={() => setTag(null)} aria-label={`Remove tag filter ${tag}`}>
              Tag: {tag} ×
            </button>
          ) : null}
          {q ? (
            <button
              type="button"
              className="pn-comm__chip"
              onClick={() => {
                setQ("");
                setDraft("");
              }}
              aria-label={`Clear search for ${q}`}
            >
              Search: {q} ×
            </button>
          ) : null}
        </div>
      ) : null}

      <div aria-live="polite" className="pn-comm__live">
        {loading ? (
          <p className="pn-comm__muted" data-testid="community-loading">
            Loading posts…
          </p>
        ) : null}
      </div>

      {!loading && result && !result.ok ? (
        <div className="pn-comm__panel" role="alert" data-testid="community-error">
          <p className="pn-comm__body">{result.message ?? "Posts could not be loaded."}</p>
          <button type="button" className="pn-btn pn-btn--secondary pn-comm__small" onClick={() => setReload((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : null}

      {!loading && result?.ok && result.posts.length === 0 ? (
        <p className="pn-comm__empty" data-testid="community-empty">
          {effectiveScope === "mine"
            ? "You have not posted yet."
            : effectiveScope === "saved"
              ? "No saved posts yet."
              : filtering
                ? "No posts match. Try another topic or search."
                : "No posts yet. Start the first one."}
        </p>
      ) : null}

      {!loading && result?.ok && result.posts.length > 0 ? (
        <ul className="pn-comm__list" data-testid="community-list">
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
                  {p.tags.map((t) => (
                    <button key={t} type="button" className="pn-comm__tag" onClick={() => setTag(t)} aria-label={`Show posts tagged ${t}`}>
                      #{t}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="pn-comm__meta">
                <span>{p.isOwn ? "You" : p.authorHandle}</span>
                <span>{formatDate(p.createdAt)}</span>
                <span>{p.helpfulCount} found this helpful</span>
                <span>{p.commentCount} {p.commentCount === 1 ? "comment" : "comments"}</span>
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
                    {p.viewerBookmarked ? "Saved" : "Save"}
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
        <button type="button" className="pn-btn pn-btn--secondary pn-comm__action" onClick={() => void loadMore()} disabled={loadingMore} data-testid="community-more">
          {loadingMore ? "Loading…" : "Show more"}
        </button>
      ) : null}

      <p className="pn-comm__notice" data-testid="community-disclaimer">
        {UNVERIFIED_NOTICE} A fare or route tip here is not an official fare or route.
      </p>

      {signedIn ? <BlockedPeople onChanged={() => setReload((n) => n + 1)} /> : null}
    </div>
  );
}

/** The people this commuter blocked, with a way to undo it. Their posts and comments stay hidden until then. */
function BlockedPeople({ onChanged }: { onChanged: () => void }) {
  const [people, setPeople] = useState<{ id: string; handle: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetchCommunityMe();
    if (r.ok) setPeople(r.data.blocked);
    else setError(r.message);
  }, []);
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
      <summary>Blocked people ({people.length})</summary>
      <ul className="pn-comm__history">
        {people.map((p) => (
          <li key={p.id}>
            <span>{p.handle}</span>
            <button
              type="button"
              className="pn-btn pn-btn--secondary pn-comm__small"
              onClick={async () => {
                const r = await unblockPerson(p.id);
                if (!r.ok) return setError(r.message);
                await load();
                onChanged();
              }}
              aria-label={`Unblock ${p.handle}`}
            >
              Unblock
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p className="pn-comm__error" role="alert">
          {error}
        </p>
      ) : null}
    </details>
  );
}
