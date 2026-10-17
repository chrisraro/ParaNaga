import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLAGS,
  decideModeration,
  mayClassifyWithJev,
  type JevOutcome,
  type ModerationFlags,
} from "@/domain/moderation/policy";

const ok = (recommendation: "publish" | "reject" | "human_review", confidence: number): JevOutcome => ({
  status: "ok",
  verdict: { recommendation, confidence },
});
const down: JevOutcome = { status: "unavailable", reason: "timeout" };
const auto: ModerationFlags = { ...DEFAULT_FLAGS, autoPublishEnabled: true };

describe("decideModeration (community)", () => {
  it("fails pending on any Jev failure or no result, with auto-publish on or off", () => {
    for (const flags of [DEFAULT_FLAGS, auto]) {
      for (const jev of [down, null, { status: "unavailable", reason: "budget_exhausted" } as JevOutcome]) {
        expect(decideModeration({ kind: "community", jev, flags })).toEqual({ status: "pending", reason: "jev_unavailable" });
      }
    }
  });

  it("never publishes when auto-publish is off", () => {
    expect(decideModeration({ kind: "community", jev: ok("publish", 1), flags: DEFAULT_FLAGS })).toEqual({
      status: "pending",
      reason: "auto_publish_disabled",
    });
  });

  it("rejects only at high certainty, regardless of auto-publish", () => {
    for (const flags of [DEFAULT_FLAGS, auto]) {
      expect(decideModeration({ kind: "community", jev: ok("reject", 0.95), flags }).status).toBe("rejected");
      expect(decideModeration({ kind: "community", jev: ok("reject", 0.9), flags })).toEqual({
        status: "pending",
        reason: "low_confidence",
      });
    }
  });

  it("publishes only with auto-publish on and confidence >= 0.8", () => {
    expect(decideModeration({ kind: "community", jev: ok("publish", 0.8), flags: auto }).status).toBe("published");
    expect(decideModeration({ kind: "community", jev: ok("publish", 0.79), flags: auto })).toEqual({
      status: "pending",
      reason: "low_confidence",
    });
  });

  it("keeps human_review pending", () => {
    expect(decideModeration({ kind: "community", jev: ok("human_review", 1), flags: auto })).toEqual({
      status: "pending",
      reason: "needs_human_review",
    });
  });

  it("treats an out-of-range confidence as unavailable", () => {
    expect(decideModeration({ kind: "community", jev: ok("publish", 1.5), flags: auto }).status).toBe("pending");
    expect(decideModeration({ kind: "community", jev: ok("reject", Number.NaN), flags: auto }).status).toBe("pending");
  });
});

describe("decideModeration (complaint)", () => {
  it("is pending complaints_not_classified unless both switches are on", () => {
    for (const flags of [
      DEFAULT_FLAGS,
      { ...auto, complaintsEnabled: true },
      { ...auto, complaintsLegalClearance: true },
    ]) {
      expect(decideModeration({ kind: "complaint", jev: ok("publish", 1), flags })).toEqual({
        status: "pending",
        reason: "complaints_not_classified",
      });
    }
  });

  it("is never published or rejected even when classification is on", () => {
    const on = { autoPublishEnabled: true, complaintsEnabled: true, complaintsLegalClearance: true };
    for (const jev of [ok("publish", 1), ok("reject", 1), down, null]) {
      expect(decideModeration({ kind: "complaint", jev, flags: on }).status).toBe("pending");
    }
  });
});

describe("mayClassifyWithJev", () => {
  it("gates complaints on both flags", () => {
    expect(mayClassifyWithJev("community", DEFAULT_FLAGS)).toBe(true);
    expect(mayClassifyWithJev("complaint", DEFAULT_FLAGS)).toBe(false);
    expect(mayClassifyWithJev("complaint", { ...DEFAULT_FLAGS, complaintsEnabled: true })).toBe(false);
    expect(
      mayClassifyWithJev("complaint", { ...DEFAULT_FLAGS, complaintsEnabled: true, complaintsLegalClearance: true }),
    ).toBe(true);
  });
});
