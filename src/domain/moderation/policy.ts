// Pure fail-pending moderation gate (spec §3.8). No I/O. Every uncertain or failed path is
// 'pending' (human review); nothing here ever blocks a submission.

export type ContentKind = "community" | "complaint";

/** What Jev said about a piece of text (already validated by the adapter). */
export type JevVerdict = {
  recommendation: "publish" | "reject" | "human_review";
  /** 0..1 confidence in the recommendation. */
  confidence: number;
};

export type JevUnavailableReason =
  | "not_configured"
  | "budget_exhausted"
  | "timeout"
  | "network"
  | "auth"
  | "rate_limited"
  | "server_error"
  | "client_error"
  | "malformed"
  | "model_mismatch"
  | "complaints_not_classified";

/** `null` means Jev was not asked (for example complaints while the gate is off). */
export type JevOutcome =
  | { status: "ok"; verdict: JevVerdict }
  | { status: "unavailable"; reason: JevUnavailableReason }
  | null;

export type ModerationFlags = {
  autoPublishEnabled: boolean;
  /** JEV_COMPLAINTS_ENABLED */
  complaintsEnabled: boolean;
  /** Legal clearance (privacy impact assessment + zero-retention confirmed). Default off. */
  complaintsLegalClearance: boolean;
};

export const DEFAULT_FLAGS: ModerationFlags = {
  autoPublishEnabled: false,
  complaintsEnabled: false,
  complaintsLegalClearance: false,
};

export const REJECT_CONFIDENCE = 0.95;
export const PUBLISH_CONFIDENCE = 0.8;

export type ModerationOutcome =
  | { status: "published"; reason: "jev_publish" }
  | { status: "rejected"; reason: "jev_high_certainty_reject" }
  | {
      status: "pending";
      reason:
        | "complaints_not_classified"
        | "complaint_human_only"
        | "jev_unavailable"
        | "auto_publish_disabled"
        | "needs_human_review"
        | "low_confidence";
    };

/** Complaint text goes to Jev only with both switches on. Callers must check this before any I/O. */
export function mayClassifyWithJev(kind: ContentKind, flags: ModerationFlags): boolean {
  if (kind === "community") return true;
  return flags.complaintsEnabled && flags.complaintsLegalClearance;
}

export function decideModeration(input: {
  kind: ContentKind;
  jev: JevOutcome;
  flags: ModerationFlags;
}): ModerationOutcome {
  const { kind, jev, flags } = input;

  if (kind === "complaint") {
    // Complaints are never published or rejected by Jev, even when classification is on.
    return mayClassifyWithJev(kind, flags)
      ? { status: "pending", reason: "complaint_human_only" }
      : { status: "pending", reason: "complaints_not_classified" };
  }

  if (jev === null || jev.status === "unavailable") return { status: "pending", reason: "jev_unavailable" };

  const { recommendation, confidence } = jev.verdict;
  if (!(confidence >= 0 && confidence <= 1)) return { status: "pending", reason: "jev_unavailable" };

  if (recommendation === "reject") {
    return confidence >= REJECT_CONFIDENCE
      ? { status: "rejected", reason: "jev_high_certainty_reject" }
      : { status: "pending", reason: "low_confidence" };
  }
  if (recommendation === "human_review") return { status: "pending", reason: "needs_human_review" };

  // recommendation === "publish"
  if (!flags.autoPublishEnabled) return { status: "pending", reason: "auto_publish_disabled" };
  return confidence >= PUBLISH_CONFIDENCE
    ? { status: "published", reason: "jev_publish" }
    : { status: "pending", reason: "low_confidence" };
}
