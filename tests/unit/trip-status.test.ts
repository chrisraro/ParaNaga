// Facts: the trip status (src/domain/guidance/trip-status.ts) and its words: progress along the whole
// trip, remaining distance, the arrival range with its Manila clock, the pace blend, and honesty
// (no time for a tricycle, no clock time for a partial range, the unknown wait named).
import { describe, expect, it } from "vitest";
import { NO_SPEED, type SpeedTracker } from "@/domain/eta/live-speed";
import { reduceSession, sessionSteps, startSession, type GuidanceEvent, type GuidanceSession } from "@/domain/guidance/session";
import { tripStatus, type TripStatus } from "@/domain/guidance/trip-status";
import { tripStatusText } from "@/domain/guidance/trip-status-format";
import { en } from "@/i18n/en";
import { fil } from "@/i18n/fil";
import { DEST, LOOP_A, fixAt, oneRide, streetOnly, tripOf, walkOnly } from "./guidance-fixtures";

const NOW = 1_000_000; // 08:16 in Manila, off-peak
const status = (s: GuidanceSession, fix = null as ReturnType<typeof fixAt> | null, tracker: SpeedTracker | null = null, now = NOW): TripStatus => {
  const r = tripStatus(s, sessionSteps(s), fix, now, tracker);
  if (!r) throw new Error("no status");
  return r;
};
const text = (st: TripStatus) => tripStatusText(st, en.guidance, en);
const run = (s: GuidanceSession, ...events: GuidanceEvent[]) => events.reduce(reduceSession, s);
const tap = (type: Exclude<GuidanceEvent["type"], "fix">): GuidanceEvent => ({ type }) as GuidanceEvent;
const fixEvent = (p: { lat: number; lng: number }): GuidanceEvent => ({ type: "fix", fix: fixAt(p, 10, NOW), now: NOW });

describe("progress", () => {
  it("starts at 0% with the whole trip ahead (≈ the legs' lengths) and the wait still to come", () => {
    const st = status(startSession(tripOf(oneRide()), NOW));
    expect(st.basis).toBe("distance");
    expect(st.percent).toBe(0);
    // 143 m walk + 1,000 m ride + 195 m walk
    expect(st.remainingMeters).toBe(1340);
    expect(st.waitPending).toBe(true);
    expect(st.paceUsed).toBe(false);
  });

  it("moves with the walk's straight line to its target (×1.3), never past the step's own length", () => {
    const s = startSession(tripOf(oneRide()), NOW);
    const nearer = status(s, fixAt({ lat: LOOP_A[0]!.lat - 0.0003, lng: LOOP_A[0]!.lng }, 10, NOW)); // ≈ 33 m from the stop
    expect(nearer.percent).toBeGreaterThan(0);
    expect(nearer.remainingMeters!).toBeLessThan(1340);
    const far = status(s, fixAt({ lat: LOOP_A[0]!.lat - 0.0045, lng: LOOP_A[0]!.lng }, 10, NOW)); // ≈ 500 m away: more than the plan's walk
    expect(far.percent).toBe(0);
    expect(far.remainingMeters).toBe(1340);
  });

  it("counts a finished step in full and the ride by the metres left", () => {
    let s = run(startSession(tripOf(oneRide()), NOW), tap("boarded"));
    const aboard = status(s);
    expect(aboard.percent).toBe(11); // the 143 m walk of 1,338 m
    expect(aboard.waitPending).toBe(false);
    s = run(s, fixEvent(LOOP_A[1]!), fixEvent(LOOP_A[2]!), fixEvent(LOOP_A[3]!));
    const later = status(s);
    expect(later.percent).toBeGreaterThan(aboard.percent);
    expect(later.remainingMeters!).toBeLessThan(aboard.remainingMeters!);
  });

  it("is never above 100% or below 0%, and the remaining metres never go negative", () => {
    const s = run(startSession(tripOf(walkOnly()), NOW), fixEvent(DEST));
    const st = status(s, fixAt(DEST, 5, NOW));
    expect(st.percent).toBeGreaterThanOrEqual(0);
    expect(st.percent).toBeLessThanOrEqual(100);
    expect(st.remainingMeters!).toBeGreaterThanOrEqual(0);
  });

  it("has no status once the session is not active", () => {
    const s = run(startSession(tripOf(oneRide()), NOW), tap("end"));
    expect(tripStatus(s, sessionSteps(s), null, NOW, null)).toBeNull();
  });
});

describe("arrival time", () => {
  it("is a range, with a clock time rounded to 5 minutes in Manila time", () => {
    const st = status(startSession(tripOf(oneRide()), NOW));
    expect(st.eta).not.toBeNull();
    expect(st.eta!.highMin).toBeGreaterThan(st.eta!.lowMin);
    expect(st.eta!.arriveAtMs! % (5 * 60_000)).toBe(0);
    expect(text(st).etaText).toMatch(/^≈ \d+–\d+ min · arrive about \d{1,2}:\d{2} (AM|PM)$/);
  });

  it("names the unknown wait while a boarding is ahead, and not after boarding", () => {
    const before = text(status(startSession(tripOf(oneRide()), NOW)));
    expect(before.caption).toContain("Waiting for a jeepney is not counted.");
    const aboard = text(status(run(startSession(tripOf(oneRide()), NOW), tap("boarded"))));
    expect(aboard.caption).not.toContain("Waiting");
  });

  it("shrinks as the ride goes on", () => {
    const boarded = run(startSession(tripOf(oneRide()), NOW), tap("boarded"));
    const start = status(boarded).eta!;
    const late = status(run(boarded, fixEvent(LOOP_A[1]!), fixEvent(LOOP_A[2]!), fixEvent(LOOP_A[3]!), fixEvent(LOOP_A[4]!))).eta!;
    expect(late.highMin).toBeLessThan(start.highMin);
  });

  it("blends the walker's own pace into the current leg and says so", () => {
    const s = startSession(tripOf(walkOnly()), NOW);
    const model = status(s);
    const brisk: SpeedTracker = { ...NO_SPEED, key: "k", emaMps: 1.9, samples: 12 };
    const paced = status(s, null, brisk);
    expect(paced.paceUsed).toBe(true);
    expect(paced.eta!.highMin).toBeLessThan(model.eta!.highMin);
    expect(paced.eta!.highMin).toBeGreaterThan(paced.eta!.lowMin);
    expect(text(paced).caption).toContain("adjusted to your pace");
    expect(text(model).caption).not.toContain("adjusted");
  });

  it("ignores a pace that is not yet reliable", () => {
    const s = startSession(tripOf(walkOnly()), NOW);
    const young: SpeedTracker = { ...NO_SPEED, key: "k", emaMps: 1.9, samples: 2 };
    expect(status(s, null, young)).toEqual(status(s));
  });
});

describe("honesty", () => {
  it("a tricycle trip has no time and no clock time, and says which mode is not estimated", () => {
    const st = status(startSession(tripOf(streetOnly("tricycle")), NOW));
    expect(st.eta).toBeNull();
    expect(st.unestimatedModes).toEqual(["tricycle"]);
    expect(text(st).etaText).toBe("Tricycle time not estimated");
    expect(st.remainingMeters).toBe(1500);
    expect(st.percent).toBe(0);
  });

  it("a padyak trip likewise", () => {
    expect(text(status(startSession(tripOf(streetOnly("padyak")), NOW))).etaText).toBe("Padyak time not estimated");
  });

  it("a tricycle with no distance on file counts steps and shows no distance", () => {
    const st = status(startSession(tripOf(streetOnly("tricycle", null)), NOW));
    expect(st.basis).toBe("steps");
    expect(st.remainingMeters).toBeNull();
    expect(text(st).progressText).toBe("0% done");
  });

  it("a range that covers only some legs says what is missing and gives no clock time", () => {
    const o = oneRide();
    // The first leg a tricycle to the stop (the access option), then the jeepney and the walk.
    const access = { ...streetOnly("tricycle", 400).legs[0]! };
    const st = status(startSession(tripOf({ ...o, legs: [access, ...o.legs.slice(1)] }), NOW));
    expect(st.eta).not.toBeNull();
    expect(st.eta!.arriveAtMs).toBeNull();
    expect(text(st).etaText).toMatch(/^≈ \d+–\d+ min · tricycle time not estimated$/);
  });

  it("without a model or a clock there is no time, never a made-up one", () => {
    const noModel = status(startSession({ ...tripOf(oneRide()), etaModel: null }, NOW));
    expect(noModel.eta).toBeNull();
    expect(text(noModel).etaText).toBe("Time not available");
    const noClock = status(startSession(tripOf(oneRide()), NOW), null, null, 0);
    expect(noClock.eta).toBeNull();
  });

  it("never prints a bare duration: the time line starts with ≈ or names no number", () => {
    for (const trip of [oneRide(), walkOnly(), streetOnly("tricycle")]) {
      const line = text(status(startSession(tripOf(trip), NOW))).etaText;
      if (/\d/.test(line)) expect(line.startsWith("≈")).toBe(true);
    }
  });
});

describe("words", () => {
  const st = status(startSession(tripOf(oneRide()), NOW));

  it("progress text and the bar's spoken value, in English", () => {
    const t = text(st);
    expect(t.progressText).toBe("0% done · ≈ 1.3 km left");
    expect(t.valueText).toBe("0% of the trip done, about 1.3 km left");
  });

  it("Filipino has every string and the same shape", () => {
    const t = tripStatusText(st, fil.guidance, fil);
    expect(t.progressText).toContain("0%");
    expect(t.etaText).toMatch(/^≈ \d+–\d+ min · darating nang mga \d{1,2}:\d{2} (AM|PM)$/);
    expect(t.caption).toContain("Hindi kasama ang paghihintay ng jeep.");
    expect(t.valueText).not.toContain("≈");
  });
});
