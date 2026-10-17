// Report a driver (task B8): categories, the PN-XXXX-XX reference, the strict request schema,
// per-step checks and deterministic routing. Pure, no I/O.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { COMPLAINT_CATEGORIES, COMPLAINT_CATEGORY_INFO, complaintCategoryLabel, isComplaintCategory } from "@/domain/complaints/categories";
import { generateReference, isReference, REFERENCE_ALPHABET } from "@/domain/complaints/reference";
import {
  createComplaintPayloadSchema,
  incidentTimeProblem,
  validateCategory,
  validateComplaintDescription,
  validateVehicleId,
} from "@/domain/complaints/schemas";
import { COMPLAINT_STATUS_LABELS, routeComplaint } from "@/domain/complaints/status";

describe("categories", () => {
  it("are the six from the brief, each with a plain label and hint", () => {
    expect(COMPLAINT_CATEGORIES).toEqual(["overcharging", "reckless_driving", "discount_refused", "harassment", "improper_loading", "other"]);
    expect(COMPLAINT_CATEGORY_INFO.map((c) => c.value)).toEqual([...COMPLAINT_CATEGORIES]);
    expect(complaintCategoryLabel("improper_loading")).toBe("Improper loading or unloading");
    expect(isComplaintCategory("harassment")).toBe(true);
    expect(isComplaintCategory("assault")).toBe(false);
    expect(isComplaintCategory(null)).toBe(false);
  });

  it("use calm, non-accusatory wording without banned terms", () => {
    const copy = [...COMPLAINT_CATEGORY_INFO.flatMap((c) => [c.label, c.hint]), ...Object.values(COMPLAINT_STATUS_LABELS)].join(" ");
    expect(copy).not.toMatch(/\b(ETA|live|arriving|e-jeep\w*|guilty|criminal|culprit)\b/i);
  });
});

describe("generateReference", () => {
  it("formats PN-XXXX-XX from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const ref = generateReference((n) => randomBytes(n));
      expect(ref).toMatch(/^PN-[2-9A-Z]{4}-[2-9A-Z]{2}$/);
      expect(isReference(ref)).toBe(true);
      expect(ref.slice(3)).not.toMatch(/[01OILU]/);
    }
    expect(REFERENCE_ALPHABET).toHaveLength(30);
  });

  it("drops bytes at or above 240 so no symbol is favoured", () => {
    let call = 0;
    const ref = generateReference((n) => {
      call += 1;
      // First buffer: only rejected bytes; second: 0..15 -> "23456789ABCDEFGH".
      return call === 1 ? new Uint8Array(n).fill(250) : Uint8Array.from({ length: n }, (_, i) => i);
    });
    expect(call).toBe(2);
    expect(ref).toBe("PN-2345-67");
  });

  it("is spread out: 2 000 references are unique", () => {
    const refs = new Set(Array.from({ length: 2000 }, () => generateReference((n) => randomBytes(n))));
    expect(refs.size).toBe(2000);
  });

  it("isReference refuses lowercase, ambiguous symbols and other shapes", () => {
    for (const bad of ["pn-7kq4-2m", "PN-7KQ0-2M", "PN-7KQ4-2", "PN7KQ42M", "PN-7KQ4-2MM", "XX-7KQ4-2M"]) expect(isReference(bad), bad).toBe(false);
    expect(isReference("PN-7KQ4-2M")).toBe(true);
  });
});

const NOW = Date.now();
const valid = (over: Record<string, unknown> = {}) => ({
  clientRequestId: "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a11",
  category: "overcharging",
  description: "The driver asked for 30 pesos for a short trip on the loop.",
  incidentAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
  noticeAccepted: true,
  ...over,
});

describe("createComplaintPayloadSchema", () => {
  it("accepts a minimal report and a full one", () => {
    expect(createComplaintPayloadSchema.parse(valid()).evidence).toEqual([]);
    const full = createComplaintPayloadSchema.parse(
      valid({
        gps: { lat: 13.6234, lng: 123.1847, accuracyM: 12 },
        locationText: "Near the plaza",
        operator: "Sample Transport Cooperative",
        plate: "ABC 1234",
        bodyNumber: "R4-017",
        evidence: [
          { mediaId: "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a12", captureKind: "in_app_camera", capturedAt: new Date(NOW).toISOString() },
          { mediaId: "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a13", captureKind: "file_upload" },
        ],
      }),
    );
    expect(full.evidence).toHaveLength(2);
  });

  it("is strict: server-owned fields cannot be supplied", () => {
    for (const extra of [{ status: "closed" }, { queue: "queue_priority" }, { reporterId: "user-2" }, { reference: "PN-7KQ4-2M" }, { publicRef: "x" }]) {
      expect(createComplaintPayloadSchema.safeParse(valid(extra)).success, JSON.stringify(extra)).toBe(false);
    }
    expect(createComplaintPayloadSchema.safeParse(valid({ gps: { lat: 13.62, lng: 123.18, accuracyM: 5, source: "x" } })).success).toBe(false);
  });

  it("requires the acknowledgment", () => {
    expect(createComplaintPayloadSchema.safeParse(valid({ noticeAccepted: false })).success).toBe(false);
    const rest: Record<string, unknown> = valid();
    delete rest.noticeAccepted;
    expect(createComplaintPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("caps text and refuses control or bidi characters", () => {
    expect(createComplaintPayloadSchema.safeParse(valid({ description: "too short" })).success).toBe(false);
    expect(createComplaintPayloadSchema.safeParse(valid({ description: "x".repeat(2001) })).success).toBe(false);
    expect(createComplaintPayloadSchema.safeParse(valid({ description: "x".repeat(2000) })).success).toBe(true);
    expect(createComplaintPayloadSchema.safeParse(valid({ description: "The driver said ‮something odd here" })).success).toBe(false);
    expect(createComplaintPayloadSchema.safeParse(valid({ operator: "o".repeat(121) })).success).toBe(false);
    expect(createComplaintPayloadSchema.safeParse(valid({ locationText: "l".repeat(201) })).success).toBe(false);
  });

  it("allows only plate-like vehicle ids", () => {
    expect(createComplaintPayloadSchema.safeParse(valid({ plate: "ABC-1234" })).success).toBe(true);
    for (const plate of ["<script>", "A".repeat(17), " ", "ABC_123"]) {
      expect(createComplaintPayloadSchema.safeParse(valid({ plate })).success, plate).toBe(false);
    }
  });

  it("keeps the incident in the last 12 months and not in the future", () => {
    expect(createComplaintPayloadSchema.safeParse(valid({ incidentAt: new Date(NOW + 60 * 60 * 1000).toISOString() })).success).toBe(false);
    expect(createComplaintPayloadSchema.safeParse(valid({ incidentAt: new Date(NOW - 400 * 86_400_000).toISOString() })).success).toBe(false);
    expect(createComplaintPayloadSchema.safeParse(valid({ incidentAt: "yesterday" })).success).toBe(false);
  });

  it("bounds GPS to Naga and evidence to three distinct items", () => {
    expect(createComplaintPayloadSchema.safeParse(valid({ gps: { lat: 14.6, lng: 121.0, accuracyM: 5 } })).success).toBe(false);
    expect(createComplaintPayloadSchema.safeParse(valid({ gps: { lat: 13.62, lng: 123.18, accuracyM: 6000 } })).success).toBe(false);
    const item = (i: number) => ({ mediaId: `6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a2${i}`, captureKind: "file_upload" });
    expect(createComplaintPayloadSchema.safeParse(valid({ evidence: [item(1), item(2), item(3), item(4)] })).success).toBe(false);
    expect(createComplaintPayloadSchema.safeParse(valid({ evidence: [item(1), item(1)] })).success).toBe(false);
    expect(createComplaintPayloadSchema.safeParse(valid({ evidence: [{ ...item(1), captureKind: "screenshot" }] })).success).toBe(false);
  });
});

describe("per-step checks", () => {
  it("explain what is missing", () => {
    expect(validateCategory(null)).toBe("Choose what happened.");
    expect(validateCategory("harassment")).toBeNull();
    expect(validateComplaintDescription("short")).toMatch(/at least 10/);
    expect(validateComplaintDescription("A long enough description.")).toBeNull();
    expect(validateVehicleId("", "Plate number")).toBeNull();
    expect(validateVehicleId("AB$", "Plate number")).toMatch(/^Plate number:/);
    expect(incidentTimeProblem(new Date(NOW).toISOString(), NOW)).toBeNull();
    expect(incidentTimeProblem("", NOW)).toMatch(/when it happened/);
  });
});

describe("routeComplaint", () => {
  const base = { category: "overcharging", description: "Asked for a higher fare.", evidenceCount: 1, hasVehicleId: true };
  it("raises harassment and priority words, never lowers", () => {
    expect(routeComplaint({ ...base, category: "harassment" })).toBe("queue_priority");
    expect(routeComplaint({ ...base, description: "I was sinaktan by the barker" })).toBe("queue_priority");
    expect(routeComplaint({ ...base, description: "He showed a KNIFE", evidenceCount: 0, hasVehicleId: false })).toBe("queue_priority");
  });
  it("sends reports with nothing to identify the vehicle to the completeness check", () => {
    expect(routeComplaint({ ...base, evidenceCount: 0, hasVehicleId: false })).toBe("queue_check_completeness");
    expect(routeComplaint(base)).toBe("queue_normal");
  });
});
