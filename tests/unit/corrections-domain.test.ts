import { describe, expect, it } from "vitest";
import {
  CATEGORY_INFO,
  CORRECTION_CATEGORIES,
  categoriesFor,
  categoryLabel,
  isEntityType,
} from "@/domain/corrections/categories";
import { AI_DISCLOSURE_POINTS, AI_DISCLOSURE_VERSION } from "@/domain/corrections/disclosure";
import { parseReportEntity, reportHref } from "@/domain/corrections/href";
import {
  createCorrectionPayloadSchema,
  validateDescription,
  validateWhatsWrong,
} from "@/domain/corrections/schemas";
import { CORRECTION_STATUSES, TRANSITIONS, canTransition, isTerminal, statusLabel } from "@/domain/corrections/status";
import { maskForAi } from "@/domain/moderation/mask";

const valid = {
  clientRequestId: "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a11",
  category: "wrong_curb_side",
  entityType: "stop",
  entityId: "stop-1",
  description: "The sign is on the other side of the road.",
};

describe("category list", () => {
  it("has a label and hint for every category, and no duplicates", () => {
    expect(CATEGORY_INFO.map((c) => c.value).sort()).toEqual([...CORRECTION_CATEGORIES].sort());
    for (const c of CATEGORY_INFO) {
      expect(c.label.length).toBeGreaterThan(2);
      expect(c.hint.length).toBeGreaterThan(2);
    }
  });
  it("offers the spec examples", () => {
    const labels = CATEGORY_INFO.map((c) => c.label);
    expect(labels).toEqual(
      expect.arrayContaining(["Wrong curb side", "Stop moved or removed", "Route doesn't stop here", "Fare mismatch", "Other trip problem"]),
    );
    expect(categoryLabel("fare_mismatch")).toBe("Fare mismatch");
  });
  it("filters by entity and always offers the catch-all", () => {
    expect(categoriesFor("stop").map((c) => c.value)).toContain("wrong_curb_side");
    expect(categoriesFor("fare").map((c) => c.value)).not.toContain("wrong_curb_side");
    for (const type of ["stop", "route", "fare", "trip"] as const) expect(categoriesFor(type).map((c) => c.value)).toContain("other");
    expect(categoriesFor(null)).toHaveLength(CATEGORY_INFO.length);
  });
  it("never uses live or arrival wording", () => {
    const text = CATEGORY_INFO.map((c) => `${c.label} ${c.hint}`).join(" ") + AI_DISCLOSURE_POINTS.join(" ");
    expect(text).not.toMatch(/\b(eta|live|arriving|e-?jeep)/i);
  });
});

describe("payload schema", () => {
  it("accepts a minimal valid body and defaults the optional parts", () => {
    const parsed = createCorrectionPayloadSchema.parse(valid);
    expect(parsed.mediaIds).toEqual([]);
    expect(parsed.aiDisclosureAccepted).toBe(false);
  });
  it("is strict: unknown keys are rejected", () => {
    expect(createCorrectionPayloadSchema.safeParse({ ...valid, status: "accepted" }).success).toBe(false);
    expect(createCorrectionPayloadSchema.safeParse({ ...valid, authorId: "x" }).success).toBe(false);
  });
  it("enforces the text length limits after trimming", () => {
    expect(createCorrectionPayloadSchema.safeParse({ ...valid, description: "too short" }).success).toBe(false);
    expect(createCorrectionPayloadSchema.safeParse({ ...valid, description: "x".repeat(1001) }).success).toBe(false);
    expect(createCorrectionPayloadSchema.safeParse({ ...valid, description: `  ${"x".repeat(10)}  ` }).success).toBe(true);
  });
  it("rejects control characters, bad categories and too many photos", () => {
    expect(createCorrectionPayloadSchema.safeParse({ ...valid, description: "ok ok ok ok\u0000 ok" }).success).toBe(false);
    expect(createCorrectionPayloadSchema.safeParse({ ...valid, category: "nope" }).success).toBe(false);
    const id = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a12";
    expect(createCorrectionPayloadSchema.safeParse({ ...valid, mediaIds: [id, id, id, id] }).success).toBe(false);
  });
  it("keeps a location inside Naga with a sane accuracy", () => {
    const at = (lat: number, lng: number, accuracyM: number) =>
      createCorrectionPayloadSchema.safeParse({ ...valid, location: { lat, lng, accuracyM } }).success;
    expect(at(13.6233869, 123.1846726, 12)).toBe(true);
    expect(at(14.6, 121, 12)).toBe(false);
    expect(at(13.62, 123.18, 99999)).toBe(false);
  });
  it("validates wizard steps with plain messages", () => {
    expect(validateWhatsWrong(null)).toMatch(/Choose/);
    expect(validateWhatsWrong("fare_mismatch")).toBeNull();
    expect(validateDescription("short")).toMatch(/at least 10/);
    expect(validateDescription("long enough text")).toBeNull();
  });
});

describe("status transitions", () => {
  it("follows draft, submitted, under_review, accepted or rejected, incorporated", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
    expect(canTransition("submitted", "under_review")).toBe(true);
    expect(canTransition("under_review", "accepted")).toBe(true);
    expect(canTransition("under_review", "rejected")).toBe(true);
    expect(canTransition("accepted", "incorporated")).toBe(true);
  });
  it("never lets a correction skip review or reach published data directly", () => {
    expect(canTransition("submitted", "accepted")).toBe(false);
    expect(canTransition("submitted", "incorporated")).toBe(false);
    expect(canTransition("draft", "accepted")).toBe(false);
    expect(canTransition("rejected", "accepted")).toBe(false);
  });
  it("has a row and a label for every status; end states are terminal", () => {
    for (const s of CORRECTION_STATUSES) {
      expect(TRANSITIONS[s]).toBeDefined();
      expect(statusLabel(s).length).toBeGreaterThan(2);
    }
    for (const s of ["rejected", "duplicate", "incorporated", "superseded"] as const) expect(isTerminal(s)).toBe(true);
    expect(isTerminal("submitted")).toBe(false);
  });
});

describe("report link", () => {
  it("round-trips an entity and ignores junk", () => {
    const href = reportHref({ entityType: "route", entityId: "R4", entityLabel: "Route 4" });
    expect(href.startsWith("/app/report?")).toBe(true);
    expect(parseReportEntity(new URL(`http://x${href}`).searchParams)).toEqual({ entityType: "route", entityId: "R4", entityLabel: "Route 4" });
    expect(parseReportEntity(new URLSearchParams("type=bogus&id=1"))).toBeNull();
    expect(parseReportEntity(new URLSearchParams("type=stop"))).toBeNull();
    expect(isEntityType("fare")).toBe(true);
  });
});

describe("text masking before AI", () => {
  it("hides emails, phone numbers and plates, and drops zero-width characters", () => {
    const out = maskForAi("Driver ABC 1234 said call 0917 123 4567 or a@b.com​ now");
    expect(out).not.toMatch(/ABC|1234|0917|a@b\.com|​/);
    expect(out).toContain("[plate]");
    expect(out).toContain("[email]");
    expect(out).toContain("[number]");
  });
  it("leaves plain sentences alone", () => {
    expect(maskForAi("The stop is on the left side.")).toBe("The stop is on the left side.");
  });
});

describe("disclosure", () => {
  it("is versioned", () => {
    expect(AI_DISCLOSURE_VERSION).toMatch(/^\d{4}-\d{2}-v\d+$/);
  });
});
