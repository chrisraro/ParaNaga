// My reports list, status labels, the MyNaga summary and the self-report schema (task B9). Pure.
import { describe, expect, it } from "vitest";
import { COMPLAINT_STATUSES } from "@/domain/complaints/status";
import { CORRECTION_STATUSES } from "@/domain/corrections/status";
import { buildMyNagaSummary, EVIDENCE_NOTE } from "@/domain/mynaga/summary";
import { complaintTone, correctionTone, mergeReports, outcomeLabel } from "@/domain/reports/list";
import { complaintDetailSchema, myNagaSelfReportSchema, type ComplaintDetail } from "@/domain/reports/schemas";

const ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a99";

const complaint = (over: Partial<ComplaintDetail> = {}): ComplaintDetail => ({
  id: ID,
  reference: "PN-7KQ4-2M",
  category: "overcharging",
  status: "under_review",
  submittedAt: "2026-10-17T16:00:00.000Z",
  incidentAt: "2026-10-17T14:30:00.000Z",
  description: "The driver asked for 40 pesos for a short trip.",
  locationText: "Near Centro",
  operator: "Loop A cooperative",
  plate: "ABC 1234",
  bodyNumber: null,
  outcomeCode: null,
  evidence: [{ id: ID, captureKind: "in_app_camera" }],
  events: [],
  handoff: { submitted: false, submittedAt: null, reference: null },
  ...over,
});

describe("mergeReports", () => {
  it("merges corrections and driver reports newest first with honest labels", () => {
    const rows = mergeReports(
      [
        { id: "c1", category: "wrong_curb_side", status: "incorporated", submittedAt: "2026-10-10T00:00:00.000Z" },
        { id: "c2", category: "other", status: "rejected", submittedAt: "2026-10-16T00:00:00.000Z" },
      ],
      [{ id: "d1", reference: "PN-7KQ4-2M", category: "harassment", status: "needs_information", submittedAt: "2026-10-14T00:00:00.000Z" }],
    );
    expect(rows.map((r) => r.id)).toEqual(["c2", "d1", "c1"]);
    expect(rows.map((r) => r.statusLabel)).toEqual(["Not accepted", "More information needed", "Added to the data"]);
    expect(rows[1]).toMatchObject({ kind: "complaint", reference: "PN-7KQ4-2M", href: "/app/reports/complaint/d1" });
    expect(rows[0]).toMatchObject({ kind: "correction", reference: null, href: "/app/reports/correction/c2" });
  });

  it("carries no report text: a row has only kind, category, reference, date and status", () => {
    const [row] = mergeReports([], [{ id: "d1", reference: "PN-7KQ4-2M", category: "overcharging", status: "submitted", submittedAt: "2026-10-14T00:00:00.000Z" }]);
    expect(Object.keys(row!).sort()).toEqual(["at", "categoryLabel", "href", "id", "kind", "kindLabel", "reference", "status", "statusLabel", "tone"]);
  });

  it("gives every status of both lifecycles a tone", () => {
    for (const s of CORRECTION_STATUSES) expect(correctionTone(s), s).toMatch(/^(open|waiting|done|closed)$/);
    for (const s of COMPLAINT_STATUSES) expect(complaintTone(s), s).toMatch(/^(open|waiting|done|closed)$/);
  });

  it("words closed outcomes neutrally and ignores unknown codes", () => {
    expect(outcomeLabel("insufficient_detail")).toBe("Not enough detail to follow up");
    expect(outcomeLabel("guilty")).toBeNull();
    expect(outcomeLabel(null)).toBeNull();
  });
});

describe("buildMyNagaSummary", () => {
  it("lists category, time, place, operator, plate and says evidence is available", () => {
    const text = buildMyNagaSummary(complaint());
    expect(text).toContain("Category: Overcharging");
    expect(text).toMatch(/When it happened: Oct 17, 2026, 10:30\s?PM \(Philippine time\)/);
    expect(text).toContain("Where: Near Centro");
    expect(text).toContain("Operator: Loop A cooperative");
    expect(text).toContain("Plate number: ABC 1234");
    expect(text).toContain(EVIDENCE_NOTE);
    expect(text).toContain("ParaNaga reference (for my own records): PN-7KQ4-2M");
  });

  it("leaves out empty fields and the evidence note when there is none", () => {
    const text = buildMyNagaSummary(complaint({ locationText: null, operator: null, plate: null, evidence: [] }));
    expect(text).not.toMatch(/Where:|Operator:|Plate number:|Body number:/);
    expect(text).not.toContain(EVIDENCE_NOTE);
  });

  it("never claims delivery or contains links or ids", () => {
    const text = buildMyNagaSummary(complaint());
    expect(text).not.toMatch(/https?:|received|delivered|sent to/i);
    expect(text).not.toContain(ID);
  });
});

describe("myNagaSelfReportSchema", () => {
  it("accepts submitted with or without a trimmed reference", () => {
    expect(myNagaSelfReportSchema.parse({ submitted: true })).toEqual({ submitted: true });
    expect(myNagaSelfReportSchema.parse({ submitted: true, reference: "  MN-2026-0042 " })).toEqual({ submitted: true, reference: "MN-2026-0042" });
    expect(myNagaSelfReportSchema.parse({ submitted: false })).toEqual({ submitted: false });
  });

  it("refuses unknown fields, long or control-character references and a reference without the flag", () => {
    for (const bad of [
      { submitted: true, status: "closed" },
      { submitted: true, reference: "x".repeat(65) },
      { submitted: true, reference: "" },
      { submitted: true, reference: "a\u0000b" },
      { submitted: true, reference: "a‮b" },
      { submitted: false, reference: "MN-1" },
      { reference: "MN-1" },
      { submitted: "yes" },
    ]) {
      expect(myNagaSelfReportSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("parses the detail shape the API returns", () => {
    expect(complaintDetailSchema.safeParse(complaint()).success).toBe(true);
  });
});
