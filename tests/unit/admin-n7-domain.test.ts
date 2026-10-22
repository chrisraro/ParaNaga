// N7 pure rules: complaint status transitions (mirror of priv.set_complaint_status), the action
// body, the last-admin guard the page shows before the database refuses, the diagnostic gate, the
// audit cursor and Manila day bounds.
import { describe, expect, it } from "vitest";
import { complaintActionSchema, nextStatuses } from "@/domain/admin/complaints";
import { decodeCursor, diagnosticBlocker, encodeCursor, manilaDayBound, roleChangeSchema, wouldRemoveLastAdmin, type UserCard } from "@/domain/admin/system";

describe("complaint review rules", () => {
  it("offers the 0018 transitions only; closed and withdrawn are final; withdrawn is never the reviewer's", () => {
    expect(nextStatuses("submitted")).toEqual(["under_review", "closed"]);
    expect(nextStatuses("under_review")).toEqual(["needs_information", "closed"]);
    expect(nextStatuses("needs_information")).toEqual(["under_review", "closed"]);
    expect(nextStatuses("closed")).toEqual([]);
    expect(nextStatuses("withdrawn")).toEqual([]);
  });

  it("an outcome exactly when closing; legal hold needs a reason", () => {
    expect(complaintActionSchema.safeParse({ action: "status", to: "closed", outcomeCode: "duplicate" }).success).toBe(true);
    expect(complaintActionSchema.safeParse({ action: "status", to: "closed" }).success).toBe(false);
    expect(complaintActionSchema.safeParse({ action: "status", to: "needs_information", outcomeCode: "duplicate" }).success).toBe(false);
    expect(complaintActionSchema.safeParse({ action: "legal_hold", hold: true, note: "  " }).success).toBe(false);
    expect(complaintActionSchema.parse({ action: "status", to: "under_review" })).toMatchObject({ visibility: "reviewer_only" });
  });
});

const card = (userId: string, admin: boolean, suspended = false): UserCard => ({
  userId,
  name: userId,
  email: null,
  self: false,
  suspended,
  roles: admin ? [{ role: "admin", active: true, grantedAt: "x", grantedBy: null, revokedAt: null, reason: "r" }] : [],
});

describe("users and roles", () => {
  it("flags removing the last active admin (suspended admins do not count)", () => {
    expect(wouldRemoveLastAdmin([card("a", true), card("b", true)], "a", "admin", "revoke")).toBe(false);
    expect(wouldRemoveLastAdmin([card("a", true), card("b", true, true)], "a", "admin", "revoke")).toBe(true);
    expect(wouldRemoveLastAdmin([card("a", true)], "a", "complaint_reviewer", "revoke")).toBe(false);
    expect(wouldRemoveLastAdmin([card("a", true)], "a", "admin", "grant")).toBe(false);
  });

  it("a change needs a reason and never grants commuter", () => {
    expect(roleChangeSchema.safeParse({ userId: "u", role: "admin", change: "grant", reason: "ok" }).success).toBe(false);
    expect(roleChangeSchema.safeParse({ userId: "u", role: "commuter", change: "grant", reason: "first" }).success).toBe(false);
    expect(roleChangeSchema.safeParse({ userId: "u", role: "commuter", change: "revoke", reason: "spam account" }).success).toBe(true);
  });
});

describe("Jev diagnostic gate", () => {
  it("never runs without the key or while Jev is off", () => {
    expect(diagnosticBlocker({ keyPresent: false, enabled: false, whyDisabled: "x" })).toMatch(/OpenRouter API key is not set/);
    expect(diagnosticBlocker({ keyPresent: true, enabled: false, whyDisabled: "Budget is 0." })).toBe("Budget is 0.");
    expect(diagnosticBlocker({ keyPresent: true, enabled: true, whyDisabled: null })).toBeNull();
  });
});

describe("audit paging", () => {
  it("round-trips a microsecond cursor and refuses anything else", () => {
    const id = "9a1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a01";
    expect(decodeCursor(encodeCursor("1792634400123456", id))).toEqual({ atMicros: "1792634400123456", id });
    for (const bad of ["", "x|y", `1.5|${id}`, `123|${id}|z`, `-1|${id}`]) expect(decodeCursor(bad), bad).toBeNull();
  });

  it("Manila dates: from midnight UTC+8, to the next midnight", () => {
    expect(manilaDayBound("2026-10-22")).toBe("2026-10-21T16:00:00.000Z");
    expect(manilaDayBound("2026-10-22", true)).toBe("2026-10-22T16:00:00.000Z");
    expect(manilaDayBound("2026-12-31", true)).toBe("2026-12-31T16:00:00.000Z");
  });
});
