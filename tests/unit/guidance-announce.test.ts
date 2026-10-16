// Facts: test file for src/domain/guidance/announce.ts (Task 10, fix round 1), the throttle of the
// guidance screens' polite live region. Review Important 1: every GPS-driven change within a step
// is throttled (≤ every 15 s / 50 m), the first "Close to …" per step is announced once
// (latched), and a fall-back to the step title is never announced.
import { describe, expect, it } from "vitest";
import { ANNOUNCE_MS, DISTANCE_ANNOUNCE_M, liveKind, nextPolite, resetAnnouncer, walkDistanceOf, type LiveKind } from "@/domain/guidance/announce";
import { guidanceView } from "@/domain/guidance/view";
import { reduceSession, startSession } from "@/domain/guidance/session";
import { LOOP_A, ORIGIN, fixAt, oneRide, tripOf } from "./guidance-fixtures";

const TITLE = "Walk to Plaza Rizal (A1)";
const dist = (m: number) => `About ${m} m to Plaza Rizal (A1), straight line`;
const NEAR = "Close to Plaza Rizal (A1). Tap “I'm at the stop”.";

function run(seq: [string, LiveKind, number][]) {
  let state = resetAnnouncer(TITLE, 0);
  const said: [string, number][] = [];
  for (const [text, kind, now] of seq) {
    const r = nextPolite(state, text, kind, now);
    state = r.state;
    if (r.say) said.push([r.say, now]);
  }
  return said;
}

describe("walkDistanceOf", () => {
  it("reads the straight-line walk distance lines only", () => {
    expect(walkDistanceOf(dist(240))).toBe(240);
    expect(walkDistanceOf("Under 10 m to Plaza Rizal (A1), straight line")).toBe(0);
    expect(walkDistanceOf("About 230 m to Plaza Rizal (A1)")).toBeNull(); // the basis is part of the line
    expect(walkDistanceOf("3 stops to go")).toBeNull();
    expect(walkDistanceOf("≈ 230 m")).toBeNull();
  });
});

describe("liveKind", () => {
  it("classifies the walk view's live text", () => {
    const s = startSession(tripOf(oneRide()), 1_000_000);
    expect(liveKind(guidanceView(s, null, 1_000_000))).toBe("fallback");
    expect(liveKind(guidanceView(s, fixAt(ORIGIN, 10, 1_000_000), 1_000_000))).toBe("distance");
    expect(liveKind(guidanceView(s, fixAt(LOOP_A[0]!, 10, 1_000_000), 1_000_000))).toBe("proposal");
    const ride = reduceSession(s, { type: "boarded" });
    expect(liveKind(guidanceView(ride, null, 1_000_000))).toBe("change");
  });
});

describe("nextPolite", () => {
  it("uses the brief's limits", () => {
    expect(ANNOUNCE_MS).toBe(15_000);
    expect(DISTANCE_ANNOUNCE_M).toBe(50);
  });

  it("holds distances until 15 s AND 50 m since the last announcement", () => {
    expect(run([[dist(300), "distance", 1_000]])).toEqual([]);
    expect(run([[dist(300), "distance", 15_000]])).toEqual([[dist(300), 15_000]]);
    expect(
      run([
        [dist(300), "distance", 15_000],
        [dist(200), "distance", 29_999],
        [dist(260), "distance", 60_000],
        [dist(240), "distance", 61_000],
      ]),
    ).toEqual([
      [dist(300), 15_000],
      [dist(240), 61_000],
    ]);
  });

  it("never announces a fall-back to the title", () => {
    expect(run([[dist(300), "distance", 20_000], [TITLE, "fallback", 50_000], [dist(300), "distance", 80_000]])).toEqual([[dist(300), 20_000]]);
  });

  it("announces the first proposal at once, then never again in the step", () => {
    const said = run([
      [dist(300), "distance", 20_000],
      [NEAR, "proposal", 21_000],
      [dist(40), "distance", 22_000],
      [NEAR, "proposal", 23_000],
      [TITLE, "fallback", 24_000],
      [NEAR, "proposal", 90_000],
    ]);
    expect(said).toEqual([
      [dist(300), 20_000],
      [NEAR, 21_000],
    ]);
  });

  it("throttles other GPS changes (stop counts) to once per 15 s", () => {
    expect(run([["3 stops to go", "change", 16_000], ["2 stops to go", "change", 20_000], ["1 stop to go", "change", 31_000]])).toEqual([
      ["3 stops to go", 16_000],
      ["1 stop to go", 31_000],
    ]);
  });

  it("alternating distance / title / proposal never yields two announcements within 15 s after the first proposal (property)", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      let rng = seed * 7919;
      const rand = () => ((rng = (rng * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
      let now = 0;
      const seq: [string, LiveKind, number][] = [];
      for (let i = 0; i < 300; i += 1) {
        now += Math.floor(rand() * 3000);
        const pick = rand();
        if (pick < 0.4) seq.push([dist(Math.floor(rand() * 400)), "distance", now]);
        else if (pick < 0.7) seq.push([TITLE, "fallback", now]);
        else seq.push([NEAR, "proposal", now]);
      }
      const said = run(seq);
      expect(said.filter(([t]) => t === TITLE)).toEqual([]);
      expect(said.filter(([t]) => t === NEAR).length).toBeLessThanOrEqual(1);
      const firstProposal = said.findIndex(([t]) => t === NEAR);
      const after = firstProposal === -1 ? said : said.slice(firstProposal);
      for (let i = 1; i < after.length; i += 1) expect(after[i]![1] - after[i - 1]![1]).toBeGreaterThanOrEqual(ANNOUNCE_MS);
      // Before the proposal too: only distances, each ≥ 15 s after the previous one or the start.
      const before = firstProposal === -1 ? said : said.slice(0, firstProposal);
      let last = 0;
      for (const [, at] of before) {
        expect(at - last).toBeGreaterThanOrEqual(ANNOUNCE_MS);
        last = at;
      }
    }
  });
});
