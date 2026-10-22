// The browser-side mirrors of migration 0025 (N6): what each correction status offers, the
// templated reasons, the moderation reasons and the override rule. Each list is read back from the
// SQL so the screens can never offer what the database refuses.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reviewActions, reviewPayloadSchema, type ReviewAction } from "@/domain/admin/corrections";
import { isOverride, moderatePayloadSchema, percent, PUBLISH_REASONS, reasonsFor, REJECT_REASONS as MOD_REJECT } from "@/domain/admin/moderation";
import { INFO_REASONS, REJECT_REASONS, REVIEW_REASONS, isReviewReason, reviewReasonText } from "@/domain/corrections/review-reasons";
import { canTransition, CORRECTION_STATUSES, type CorrectionStatus } from "@/domain/corrections/status";
import { en } from "@/i18n/en";
import { fil } from "@/i18n/fil";

const SQL = readFileSync("db/migrations/0025_review_moderation.sql", "utf8").replace(/\r\n/g, "\n");
const body = (name: string) => SQL.match(new RegExp(`create or replace function ${name.replace(".", "\\.")}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`))![1]!;
const list = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);

const REVIEW = body("community.admin_review_correction");
const SQL_PAIRS = [...REVIEW.match(/if not \(\(c\.status, v_to\) in \(([\s\S]*?)\)\) then/)![1]!.matchAll(/\('(\w+)', '(\w+)'\)/g)].map((m) => [m[1]!, m[2]!] as const);
const TO: Record<ReviewAction, CorrectionStatus> = { start_review: "under_review", request_info: "needs_evidence", reject: "rejected", duplicate: "duplicate", accept: "accepted" };

describe("corrections review mirrors 0025", () => {
  it("finds the SQL transition list", () => expect(SQL_PAIRS.length).toBe(11));

  it("every action a status offers is a transition the database allows, and every allowed transition is offered", () => {
    const offered = CORRECTION_STATUSES.flatMap((s) => reviewActions(s).map((a) => [s, TO[a]] as const));
    expect(offered.map((p) => p.join(">")).sort()).toEqual(SQL_PAIRS.map((p) => p.join(">")).sort());
  });

  it("the commuter-facing status model allows every reviewer transition", () => {
    for (const [from, to] of SQL_PAIRS) expect(canTransition(from as CorrectionStatus, to as CorrectionStatus), `${from}>${to}`).toBe(true);
  });

  it("templated reasons are the database's, and each has words in English and Filipino", () => {
    expect([...INFO_REASONS]).toEqual(list(REVIEW.match(/p_reason_code not in \(([^)]*)\)\) then\s+raise exception 'choose what information/)![1]!));
    expect([...REJECT_REASONS]).toEqual(list(REVIEW.match(/p_reason_code not in \(([^)]*)\)\) then\s+raise exception 'choose a reason for rejecting/)![1]!));
    for (const r of REVIEW_REASONS) {
      expect(reviewReasonText(r, en.report).length, r).toBeGreaterThan(5);
      expect(reviewReasonText(r, fil.report).length, r).toBeGreaterThan(5);
    }
    expect(isReviewReason("auto_publish_disabled")).toBe(false);
    expect(isReviewReason("need_photo")).toBe(true);
  });

  it("an accepted proposal needs a note; actions take only their own fields", () => {
    const id = "7a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a01";
    expect(reviewPayloadSchema.safeParse({ action: "accept", expectedStatus: "under_review", change: { kind: "proposal" } }).success).toBe(false);
    expect(reviewPayloadSchema.safeParse({ action: "accept", expectedStatus: "under_review", change: { kind: "proposal" }, note: "Base fare is ₱13" }).success).toBe(true);
    expect(reviewPayloadSchema.safeParse({ action: "start_review", expectedStatus: "submitted", reason: "need_photo" }).success).toBe(false);
    expect(reviewPayloadSchema.safeParse({ action: "duplicate", expectedStatus: "submitted", duplicateOf: id }).success).toBe(true);
    expect(reviewPayloadSchema.safeParse({ action: "request_info", expectedStatus: "submitted", reason: "already_correct" }).success).toBe(false);
  });
});

describe("moderation mirrors 0025", () => {
  it("the reasons are the database's", () => {
    const b = body("community.admin_moderate");
    expect(b).toContain(`p_reason_code is distinct from '${PUBLISH_REASONS[0]}'`);
    expect([...MOD_REJECT]).toEqual(list(b.match(/p_reason_code not in \(([\s\S]*?)\)\)\) then/)![1]!));
    expect(reasonsFor("published")).toEqual(["meets_guidelines"]);
    expect(reasonsFor("rejected")).not.toContain("meets_guidelines");
  });

  it("an override is a decision against Jev's typed recommendation, nothing else", () => {
    const table: [Parameters<typeof isOverride>[0], "published" | "rejected", boolean][] = [
      ["publish", "rejected", true],
      ["reject", "published", true],
      ["publish", "published", false],
      ["reject", "rejected", false],
      ["human_review", "published", false],
      ["human_review", "rejected", false],
      [null, "published", false],
      [undefined, "rejected", false],
    ];
    for (const [jev, outcome, expected] of table) expect(isOverride(jev, outcome), `${jev} ${outcome}`).toBe(expected);
  });

  it("payloads: a reason must fit the outcome; 'other' needs a note", () => {
    const id = "7a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a01";
    expect(moderatePayloadSchema.safeParse({ targetType: "comment", targetId: id, outcome: "rejected", reason: "threat" }).success).toBe(true);
    expect(moderatePayloadSchema.safeParse({ targetType: "comment", targetId: id, outcome: "published", reason: "threat" }).success).toBe(false);
    expect(moderatePayloadSchema.safeParse({ targetType: "comment", targetId: id, outcome: "rejected", reason: "other" }).success).toBe(false);
    expect(moderatePayloadSchema.safeParse({ targetType: "comment", targetId: id, outcome: "rejected", reason: "other", note: "Ad link" }).success).toBe(true);
  });

  it("confidence reads as a probability", () => {
    expect(percent(0.836)).toBe("84%");
    expect(percent(null)).toBe("–");
  });
});
