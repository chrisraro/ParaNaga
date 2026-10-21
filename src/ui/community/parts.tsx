"use client";

// Small pieces shared by the feed, the thread and the composer.

import "@/ui/kit/styles";
import "./community.css";

import Link from "next/link";
import {
  GUIDELINES_CHECKBOX,
  GUIDELINES_TEXT,
  GUIDELINES_TITLE,
} from "@/domain/community/guidelines";
import { LABEL_TEXT, type PostSummary } from "@/domain/community/schemas";
import { stateLabel, type ContentState } from "@/domain/community/status";
import { topicLabel } from "@/domain/community/topics";
import { DEFAULT_LOCALE, formatLocale, type Locale } from "@/i18n/locales";

export const formatDate = (iso: string, locale: Locale = DEFAULT_LOCALE) =>
  new Date(iso).toLocaleDateString(formatLocale(locale), { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });

/** The state of the author's own content. Always text, never colour alone. */
export function StateBadge({ state }: { state: ContentState }) {
  if (state === "published") return null;
  return (
    <span className={`pn-comm__badge ${state === "pending" ? "pn-comm__badge--pending" : "pn-comm__badge--rejected"}`} data-testid="state-badge">
      {stateLabel(state)}
    </span>
  );
}

export function PostBadges({ post }: { post: Pick<PostSummary, "label" | "topic" | "routeCode" | "state" | "hasPendingEdit"> }) {
  return (
    <div className="pn-comm__badges">
      <span className={`pn-comm__badge ${post.label === "community" ? "" : "pn-comm__badge--official"}`}>{LABEL_TEXT[post.label]}</span>
      <span className="pn-comm__badge">{topicLabel(post.topic)}</span>
      {post.routeCode ? <span className="pn-comm__badge">Route {post.routeCode}</span> : null}
      <StateBadge state={post.state} />
      {post.hasPendingEdit ? (
        <span className="pn-comm__badge pn-comm__badge--pending" data-testid="edit-badge">
          Edit awaiting review
        </span>
      ) : null}
    </div>
  );
}

/** The guidelines text with its acknowledgement box. */
export function GuidelinesAck({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <section className="pn-comm__panel" aria-labelledby={`${id}-title`} data-testid="guidelines">
      <h3 id={`${id}-title`} className="pn-comm__panel-title">
        {GUIDELINES_TITLE}
      </h3>
      <p className="pn-comm__body">{GUIDELINES_TEXT}</p>
      <label className="pn-comm__check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid="guidelines-ack" />
        <span>{GUIDELINES_CHECKBOX}</span>
      </label>
    </section>
  );
}

export function SignInPrompt({ what }: { what: string }) {
  return (
    <div className="pn-comm__panel" data-testid="community-signin">
      <p className="pn-comm__body">Sign in to {what}. Reading works without an account.</p>
      <Link href="/app/sign-in" className="pn-btn pn-btn--primary pn-comm__action">
        Sign in
      </Link>
    </div>
  );
}
