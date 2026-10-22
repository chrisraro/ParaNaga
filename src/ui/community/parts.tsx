"use client";

// Small pieces shared by the feed, the thread and the composer.

import "@/ui/kit/styles";
import "./community.css";

import Link from "next/link";
import type { PostSummary } from "@/domain/community/schemas";
import { stateLabel, type ContentState } from "@/domain/community/status";
import { topicLabel } from "@/domain/community/topics";
import { DEFAULT_LOCALE, formatLocale, type Locale } from "@/i18n/locales";
import { useLocale, useT } from "@/i18n/provider";

export const formatDate = (iso: string, locale: Locale = DEFAULT_LOCALE) =>
  new Date(iso).toLocaleDateString(formatLocale(locale), { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });

/** formatDate in the UI language. */
export function useFormatDate(): (iso: string) => string {
  const locale = useLocale();
  return (iso) => formatDate(iso, locale);
}

/** The state of the author's own content. Always text, never colour alone. */
export function StateBadge({ state }: { state: ContentState }) {
  const t = useT().community;
  if (state === "published") return null;
  return (
    <span className={`pn-comm__badge ${state === "pending" ? "pn-comm__badge--pending" : "pn-comm__badge--rejected"}`} data-testid="state-badge">
      {stateLabel(state, t)}
    </span>
  );
}

export function PostBadges({ post }: { post: Pick<PostSummary, "label" | "topic" | "routeCode" | "state" | "hasPendingEdit"> }) {
  const t = useT().community;
  return (
    <div className="pn-comm__badges">
      <span className={`pn-comm__badge ${post.label === "community" ? "" : "pn-comm__badge--official"}`}>{t.labels[post.label]}</span>
      <span className="pn-comm__badge">{topicLabel(post.topic, t)}</span>
      {post.routeCode ? <span className="pn-comm__badge">{t.routeBadge(post.routeCode)}</span> : null}
      <StateBadge state={post.state} />
      {post.hasPendingEdit ? (
        <span className="pn-comm__badge pn-comm__badge--pending" data-testid="edit-badge">
          {t.editAwaiting}
        </span>
      ) : null}
    </div>
  );
}

/** The guidelines text with its acknowledgement box. */
export function GuidelinesAck({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  const tt = useT();
  return (
    <section className="pn-comm__panel" aria-labelledby={`${id}-title`} data-testid="guidelines">
      <h3 id={`${id}-title`} className="pn-comm__panel-title">
        {tt.community.guidelinesTitle}
      </h3>
      {/* The guidelines are English in every language until their verbatim-reviewed translation. */}
      <p className="pn-comm__body">{tt.acknowledgments.community}</p>
      <label className="pn-comm__check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid="guidelines-ack" />
        <span>{tt.community.guidelinesCheckbox}</span>
      </label>
    </section>
  );
}

/** `text` is the whole sentence (community.signInWrite, signInEdit or signInComment). */
export function SignInPrompt({ text }: { text: string }) {
  const tt = useT();
  return (
    <div className="pn-comm__panel" data-testid="community-signin">
      <p className="pn-comm__body">{text}</p>
      <Link href="/app/sign-in" className="pn-btn pn-btn--primary pn-comm__action">
        {tt.forms.signIn}
      </Link>
    </div>
  );
}
