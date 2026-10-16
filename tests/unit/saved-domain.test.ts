import { describe, expect, it } from "vitest";
import { planResponseSchema, type PlanResponse } from "@/domain/api/plan";
import type { NetworkSnapshot } from "@/domain/api/schemas";
import {
  HISTORY_RETENTION_DAYS,
  buildSavedTrip,
  RECORD_FORMAT,
  cleanPlaceLabel,
  codePointLength,
  decodeStored,
  matchSavedTrip,
  takeCodePoints,
  findSavedPlace,
  savePlacePrefill,
  historyEntrySchema,
  historyLine,
  parseRecords,
  placeSubText,
  pruneHistory,
  resolveReopen,
  revalidateSavedTrip,
  savedPlaceSchema,
  savedTripKey,
  savedTripResponse,
  savedTripSchema,
  shareText,
  tripCardMeta,
  type SavedTrip,
} from "@/domain/saved/saved";
import { estimateOption } from "@/domain/eta/eta";
import { formatTotal } from "@/domain/eta/format";
import { LEAST_WALKING_ONLY_PLAN, PROVISIONAL_PLAN, REVISION } from "../e2e/fixtures/plan-responses";
import { ETA_MODEL, manila } from "./eta-fixtures";

const AT = manila("09:30");

const plan: PlanResponse = planResponseSchema.parse(PROVISIONAL_PLAN);
const option = plan.plan.options[0]!;
const START = { label: "Plaza Rizal", point: { lat: 13.6224, lng: 123.1838 } };
const DEST = { label: "Avenue Square", point: { lat: 13.6305, lng: 123.1912 } };

function card(overrides: Partial<SavedTrip> = {}): SavedTrip {
  return { ...buildSavedTrip({ id: "trip-1", savedAt: "2026-10-16T02:00:00.000Z", data: plan, option, start: START, destination: DEST }), ...overrides };
}

const NEW_REVISION = "11111111-2222-4333-8444-555555555555";
const rideLeg = option.legs.find((l) => l.kind === "ride")!;
if (rideLeg.kind !== "ride") throw new Error("fixture has no ride leg");

/** A snapshot of a newer revision holding the saved trip's variant and stops unchanged. */
function snapshot(edit: (s: Pick<NetworkSnapshot, "revision" | "stops" | "variants">) => void = () => undefined) {
  const stops = plan.stops.map((s, i) => ({
    id: s.id, name: s.name, lat: 13.62 + i / 1000, lng: 123.18, status: "candidate" as const, navigationApproved: false,
    source: { layer: "Loop A", code: s.code, label: s.name },
  }));
  const s: Pick<NetworkSnapshot, "revision" | "stops" | "variants"> = {
    revision: { revisionId: NEW_REVISION, label: "next", kind: "provisional", publishedAt: "2026-11-01T00:00:00.000Z" },
    stops,
    variants: [
      {
        variantId: rideLeg.variantId, routeId: NEW_REVISION, routeCode: "R8-A", routeName: "Centro–Magsaysay Loop A",
        direction: "circuit", kind: "trial", evidenceLevel: "provisional", verification: "unverified", isCircular: true,
        stopIds: plan.stops.map((x) => x.id), mode: "jeepney", measuresM: null, pathLengthM: null,
      },
    ],
  };
  edit(s);
  return s;
}

describe("saved trip card", () => {
  it("keeps the option, its revision, and only the stops and variants it names", () => {
    const c = card();
    expect(savedTripSchema.safeParse(c).success).toBe(true);
    expect(c.revisionId).toBe(REVISION.revisionId);
    expect(c.revisionLabel).toBe(REVISION.label);
    expect(c.publishedAt).toBe(REVISION.publishedAt);
    expect(c.option).toEqual(option);
    expect(c.stops.map((s) => s.code)).toEqual(["A1", "A2", "A3", "A4", "A5"]);
    expect(c.variants).toHaveLength(1);
  });

  it("rebuilds a plan response that the shared schema accepts (works without the network)", () => {
    const rebuilt = savedTripResponse(card());
    expect(planResponseSchema.safeParse(rebuilt).success).toBe(true);
    expect(rebuilt.plan.options).toEqual([option]);
    expect(rebuilt.revision.revisionId).toBe(REVISION.revisionId);
  });

  it("keys a trip by option and both points", () => {
    expect(savedTripKey(option.id, START.point, DEST.point)).toBe(savedTripKey(option.id, { ...START.point }, { ...DEST.point }));
    expect(savedTripKey(option.id, START.point, DEST.point)).not.toBe(savedTripKey(option.id, DEST.point, START.point));
  });

  it("meta line: estimate text, the fare chip text and the data date", () => {
    expect(tripCardMeta(card(), ETA_MODEL, AT)).toMatch(/^Estimate \d+–\d+ min \+ waiting \(unknown\) · Estimate ₱14 · data from 16 Oct 2026$/);
    expect(tripCardMeta(card({ publishedAt: null }), ETA_MODEL, AT)).toContain(" · Estimate ₱14 · data from revision modes-lines-2026-10-16");
  });

  it("meta line: the saved card's estimate equals trip options' for the same option, model and time", () => {
    for (const at of [manila("07:10"), manila("09:30")]) {
      const res = estimateOption(option, [], ETA_MODEL, at); // options without the walk graph: ×1.3 walks
      if (!res.ok) throw new Error(res.reason);
      expect(tripCardMeta(card(), ETA_MODEL, at).startsWith(`${formatTotal(res.estimate.total)} · `)).toBe(true);
    }
    // Walk-graph lengths, when cached, are used the same way.
    const lengths = option.legs.map((l) => (l.kind === "walk" ? 50 : null));
    const res = estimateOption(option, lengths, ETA_MODEL, AT);
    if (!res.ok) throw new Error(res.reason);
    expect(tripCardMeta(card(), ETA_MODEL, AT, lengths).startsWith(`${formatTotal(res.estimate.total)} · `)).toBe(true);
  });

  it("meta line: no model on file (an older snapshot) → Time not available, never a guess", () => {
    expect(tripCardMeta(card(), null, AT)).toBe("Time not available · Estimate ₱14 · data from 16 Oct 2026");
    expect(tripCardMeta(card(), undefined, AT)).toMatch(/^Time not available · /);
  });
});

describe("reading device records (corrupt records skipped, never thrown)", () => {
  it("drops records that fail the schema and counts them", () => {
    const good = card();
    const raw: unknown[] = [good, { ...good, id: "" }, null, "text", { ...good, option: { id: "x" } }, { ...good, start: { label: "A", point: { lat: 999, lng: 0 } } }];
    const result = parseRecords(savedTripSchema, raw);
    expect(result.records).toEqual([good]);
    expect(result.dropped).toBe(5);
  });

  it("validates saved places and history entries", () => {
    const place = { id: "p1", label: "Home", point: { lat: 13.62, lng: 123.18 }, source: "pinned", savedAt: "2026-10-16T02:00:00.000Z" };
    expect(parseRecords(savedPlaceSchema, [place, { ...place, label: "x".repeat(41) }, { ...place, source: "gps" }]).records).toEqual([place]);
    const entry = { id: "h1", from: "Plaza Rizal", to: "SM City Naga", at: "2026-10-16T02:00:00.000Z" };
    expect(parseRecords(historyEntrySchema, [entry, { ...entry, at: "yesterday" }]).records).toEqual([entry]);
  });

  it("history entries never keep coordinates, even if a record carries them", () => {
    const parsed = parseRecords(historyEntrySchema, [{ id: "h1", from: "A", to: "B", at: "2026-10-16T02:00:00.000Z", point: { lat: 13.6, lng: 123.1 } }]);
    expect(parsed.records[0]).not.toHaveProperty("point");
  });
});

describe("revalidateSavedTrip", () => {
  it("same revision → current", () => {
    expect(revalidateSavedTrip(card(), { ...snapshot(), revision: { ...REVISION, kind: "provisional" } })).toBe("current");
  });

  it("new revision, same variant, stop order and stops → unchanged_in_new_revision", () => {
    expect(revalidateSavedTrip(card(), snapshot())).toBe("unchanged_in_new_revision");
  });

  it("a ride across the loop's start still matches a circular variant", () => {
    const s = snapshot((x) => {
      const ids = x.variants[0]!.stopIds;
      x.variants[0]!.stopIds = [...ids.slice(3), ...ids.slice(0, 3)];
    });
    expect(revalidateSavedTrip(card(), s)).toBe("unchanged_in_new_revision");
  });

  it("variant removed → changed", () => {
    expect(revalidateSavedTrip(card(), snapshot((x) => (x.variants = [])))).toBe("changed");
  });

  it("stop order changed between board and alight → changed", () => {
    const s = snapshot((x) => {
      const ids = [...x.variants[0]!.stopIds];
      [ids[1], ids[2]] = [ids[2]!, ids[1]!];
      x.variants[0]!.stopIds = ids;
    });
    expect(revalidateSavedTrip(card(), s)).toBe("changed");
  });

  it("a referenced stop removed → changed", () => {
    expect(revalidateSavedTrip(card(), snapshot((x) => (x.stops = x.stops.slice(1))))).toBe("changed");
  });
});

describe("resolveReopen (re-plan against the current data)", () => {
  it("same revision and the option is there → current", () => {
    expect(resolveReopen(card(), plan)).toEqual({ kind: "current", optionId: option.id });
  });

  it("new revision with the same rides → replanned (shown as re-planned, never as the old plan)", () => {
    const live = { ...plan, revision: { ...plan.revision, revisionId: NEW_REVISION }, plan: { ...plan.plan, revisionId: NEW_REVISION } };
    expect(resolveReopen(card(), live)).toEqual({ kind: "replanned", optionId: option.id });
  });

  it("the saved option is gone → changed", () => {
    expect(resolveReopen(card(), planResponseSchema.parse(LEAST_WALKING_ONLY_PLAN))).toEqual({ kind: "changed" });
  });

  it("no coverage now → changed", () => {
    const none = { ...plan, plan: { ...plan.plan, coverage: "none" as const, options: [] } };
    expect(resolveReopen(card(), none)).toEqual({ kind: "changed" });
  });
});

describe("shareText", () => {
  const input = () => ({ ...card(), start: START, destination: DEST });

  it("lists steps by stop name and code, the badge and the fare, with no coordinates and no links", () => {
    const text = shareText(input(), { etaModel: ETA_MODEL, departure: AT });
    expect(text).toContain("Plaza Rizal to Avenue Square");
    expect(text).toContain("Unverified route — confirm with the driver");
    expect(text).toContain("Plaza Rizal (A1)");
    expect(text).toContain("Avenue Square (A5)");
    expect(text).toContain("Fare: Estimate ₱14 · from reported fare rules");
    expect(text).toContain("Estimate");
    expect(text).not.toContain("Time not available");
    // No coordinate-like numbers (digits with a decimal point and many decimals), no URLs.
    expect(text).not.toMatch(/\d+\.\d{3,}/);
    expect(text).not.toMatch(/13\.6|123\.1/);
    expect(text).not.toMatch(/https?:|www\.|\/app\//);
  });

  it("uses the snapshot's model: no model → Time not available", () => {
    const res = estimateOption(option, [], ETA_MODEL, AT);
    if (!res.ok) throw new Error(res.reason);
    expect(shareText(input(), { etaModel: ETA_MODEL, departure: AT })).toContain(`${formatTotal(res.estimate.total)}. Data revision`);
    expect(shareText(input(), { etaModel: null })).toContain("Time not available. Data revision");
  });

  it("adds the exact points only when asked", () => {
    const text = shareText(input(), { exactPoints: true });
    expect(text).toContain("13.62240, 123.18380");
    expect(text).toContain("13.63050, 123.19120");
  });
});

describe("saved places", () => {
  it("cleans a label to plain text of 1–40 characters", () => {
    expect(cleanPlaceLabel("  Lola's   house \n")).toEqual({ ok: true, label: "Lola's house" });
    expect(cleanPlaceLabel("a\u0000b\u0007c")).toEqual({ ok: true, label: "abc" });
    expect(cleanPlaceLabel("   ").ok).toBe(false);
    expect(cleanPlaceLabel("x".repeat(41)).ok).toBe(false);
    expect(cleanPlaceLabel("x".repeat(40))).toEqual({ ok: true, label: "x".repeat(40) });
  });

  it("names where a saved place came from", () => {
    expect(placeSubText("osm")).toBe("Saved place · OpenStreetMap");
    expect(placeSubText("pin")).toBe("Saved place · Mapped pin");
    expect(placeSubText("pinned")).toBe("Saved place · Pinned location");
  });
});

describe("history", () => {
  it("is labels and a date only", () => {
    expect(historyLine({ id: "h", from: "Plaza Rizal", to: "SM City Naga", at: "2026-10-15T20:00:00.000Z" })).toBe("Plaza Rizal → SM City Naga · 16 Oct 2026");
  });

  it(`prunes entries older than ${HISTORY_RETENTION_DAYS} days`, () => {
    const now = Date.parse("2026-10-16T00:00:00.000Z");
    const day = 86_400_000;
    const entries = [
      { id: "new", from: "A", to: "B", at: new Date(now - day).toISOString() },
      { id: "edge", from: "A", to: "B", at: new Date(now - (HISTORY_RETENTION_DAYS - 1) * day).toISOString() },
      { id: "old", from: "A", to: "B", at: new Date(now - (HISTORY_RETENTION_DAYS + 1) * day).toISOString() },
    ];
    const { keep, expired } = pruneHistory(entries, now);
    expect(keep.map((e) => e.id)).toEqual(["new", "edge"]);
    expect(expired).toEqual(["old"]);
  });
});

describe("matching saved places", () => {
  it("finds a saved place at the same point (6 decimals) only", () => {
    const places = [{ id: "a", point: { lat: 13.6233869, lng: 123.1846726 } }];
    expect(findSavedPlace(places, { lat: 13.62338691, lng: 123.18467259 })?.id).toBe("a");
    expect(findSavedPlace(places, { lat: 13.6234, lng: 123.1846726 })).toBeNull();
  });

  it("prefills a trip end's name", () => {
    expect(savePlacePrefill({ source: "map", label: "Pinned location" })).toBe("Pinned location");
    expect(savePlacePrefill({ source: "gps", label: "Your location" })).toBe("Pinned location");
    expect(savePlacePrefill({ source: "search", label: "Plaza Rizal (mapped pin)" })).toBe("Plaza Rizal");
    expect(savePlacePrefill({ source: "search", label: "SM City Naga" })).toBe("SM City Naga");
  });
});

describe("record format and decoding", () => {
  it("a newer-format record is skipped as newer (kept by the store), an invalid one as invalid", () => {
    const good = card();
    expect(decodeStored({ ...good, v: RECORD_FORMAT }, savedTripSchema)).toEqual({ ok: true, record: good });
    expect(decodeStored(good, savedTripSchema)).toEqual({ ok: true, record: good });
    expect(decodeStored({ ...good, v: RECORD_FORMAT + 1, extra: "future" }, savedTripSchema)).toEqual({ ok: false, reason: "newer_format" });
    expect(decodeStored({ id: "x" }, savedTripSchema)).toEqual({ ok: false, reason: "invalid" });
    expect(decodeStored(null, savedTripSchema)).toEqual({ ok: false, reason: "invalid" });
  });

  // The raw format-1 record: the legacy plan body of the e2e fixture (no mode, no board/alight, no
  // path or basis) saved before Increment E, stored with v: 1 (or no v at all).
  const legacyOption = PROVISIONAL_PLAN.plan.options[0] as unknown as Record<string, unknown>;
  const formatOne = () => ({ ...JSON.parse(JSON.stringify(card())), option: JSON.parse(JSON.stringify(legacyOption)), v: 1 });

  it("a format-1 saved record (legacy plan body) migrates to the current schema and reopens", () => {
    expect(legacyOption).not.toHaveProperty("mode");
    expect(RECORD_FORMAT).toBe(2);
    const decoded = decodeStored(formatOne(), savedTripSchema);
    if (!decoded.ok) throw new Error(decoded.reason);
    expect(decoded.record.option.mode).toBe("jeepney");
    const reopened = savedTripResponse(decoded.record);
    expect(planResponseSchema.safeParse(reopened).success).toBe(true);
    expect(resolveReopen(decoded.record, { ...plan, plan: { ...plan.plan, options: [decoded.record.option] } })).toEqual({ kind: "current", optionId: decoded.record.option.id });
    const noVersion: Record<string, unknown> = formatOne();
    delete noVersion.v;
    expect(decodeStored(noVersion, savedTripSchema).ok).toBe(true);
  });

  it("format-1 code (rollback) keeps a format-2 record as newer_format and never opens it", () => {
    // Frozen copy of the format-1 decoder on master (RECORD_FORMAT = 1, no migrations).
    const decodeFormat1 = (value: Record<string, unknown>) => {
      const v = typeof value.v === "number" && Number.isInteger(value.v) ? value.v : 1;
      return v > 1 ? { ok: false, reason: "newer_format" } : { ok: true };
    };
    expect(decodeFormat1({ ...card(), v: RECORD_FORMAT })).toEqual({ ok: false, reason: "newer_format" });
    expect(decodeFormat1(formatOne())).toEqual({ ok: true });
  });
});

describe("labels count code points", () => {
  it("never splits a surrogate pair and counts an emoji once", () => {
    const label = "🏠".repeat(40);
    expect(codePointLength(label)).toBe(40);
    expect(cleanPlaceLabel(label)).toEqual({ ok: true, label });
    expect(savedPlaceSchema.safeParse({ id: "p", label, point: { lat: 13.6, lng: 123.1 }, source: "pinned", savedAt: "2026-10-16T02:00:00.000Z" }).success).toBe(true);
    expect(takeCodePoints("🏠".repeat(41), 40)).toBe(label);
    expect(savePlacePrefill({ source: "search", label: "🏠".repeat(45) })).toBe(label);
  });
});

describe("matchSavedTrip", () => {
  it("saved on this revision, saved on an older one, or not saved", () => {
    const c = card();
    expect(matchSavedTrip([c], option.id, START.point, DEST.point, REVISION.revisionId)).toEqual({ kind: "saved", trip: c });
    expect(matchSavedTrip([c], option.id, START.point, DEST.point, NEW_REVISION)).toEqual({ kind: "older", trip: c });
    expect(matchSavedTrip([c], "other", START.point, DEST.point, REVISION.revisionId)).toEqual({ kind: "none" });
  });

  it("a trip saved from routed walks (decoded path on screen) still validates", () => {
    const coords = [START.point, DEST.point];
    const legs = option.legs.map((l) =>
      l.kind === "walk" ? { ...l, path: { kind: "path", coords, lengthM: 40, snapFromM: 0, snapToM: 0, label: "x" } } : l,
    ) as typeof option.legs;
    const c = buildSavedTrip({ id: "t", savedAt: "2026-10-16T02:00:00.000Z", data: plan, option: { ...option, legs }, start: START, destination: DEST });
    expect(savedTripSchema.safeParse(c).success).toBe(true);
  });

  it("keeps where a trip end came from", () => {
    const c = buildSavedTrip({ id: "t", savedAt: "2026-10-16T02:00:00.000Z", data: plan, option, start: { ...START, place: "osm" }, destination: DEST });
    expect(savedTripSchema.parse(c).start.place).toBe("osm");
    expect(c.destination).not.toHaveProperty("place");
  });
});
