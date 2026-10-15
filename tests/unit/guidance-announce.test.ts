// Facts: new test file for src/domain/guidance/announce.ts (Task 10), the throttle of the guidance
// screens' polite live region; inputs are the view's `live` text and a clock in ms; the brief asks
// for walk distance updates at most every 15 s and 50 m.
import { describe, expect, it } from "vitest";
import { DISTANCE_ANNOUNCE_M, DISTANCE_ANNOUNCE_MS, nextPoliteAnnouncement, walkDistanceOf } from "@/domain/guidance/announce";

const dist = (m: number) => `≈ ${m} m to Plaza Rizal (A1) in a straight line`;

describe("walkDistanceOf", () => {
  it("reads the straight-line walk distance lines only", () => {
    expect(walkDistanceOf(dist(240))).toBe(240);
    expect(walkDistanceOf("Under 10 m to Plaza Rizal (A1) in a straight line")).toBe(0);
    expect(walkDistanceOf("3 stops to go")).toBeNull();
    expect(walkDistanceOf("Walk to Plaza Rizal (A1)")).toBeNull();
    expect(walkDistanceOf("≈ 230 m walk · straight-line estimate, path not verified")).toBeNull();
  });
});

describe("nextPoliteAnnouncement", () => {
  it("uses the brief's limits", () => {
    expect(DISTANCE_ANNOUNCE_MS).toBe(15_000);
    expect(DISTANCE_ANNOUNCE_M).toBe(50);
  });

  it("announces the first text and any change that is not a distance update", () => {
    const first = nextPoliteAnnouncement(null, "Walk to Plaza Rizal (A1)", 0);
    expect(first?.text).toBe("Walk to Plaza Rizal (A1)");
    expect(nextPoliteAnnouncement(first, "Walk to Plaza Rizal (A1)", 1)).toBeNull();
    const next = nextPoliteAnnouncement(first, "Wait for Loop A at Plaza Rizal (A1)", 2);
    expect(next?.text).toBe("Wait for Loop A at Plaza Rizal (A1)");
  });

  it("announces the first distance at once (it replaces another text)", () => {
    const title = nextPoliteAnnouncement(null, "Walk to Plaza Rizal (A1)", 0);
    expect(nextPoliteAnnouncement(title, dist(240), 1_000)?.text).toBe(dist(240));
  });

  it("holds a distance update until 15 s AND 50 m have passed since the last one", () => {
    const a = nextPoliteAnnouncement(null, dist(300), 0)!;
    expect(nextPoliteAnnouncement(a, dist(200), 14_999)).toBeNull(); // 100 m but too soon
    expect(nextPoliteAnnouncement(a, dist(260), 60_000)).toBeNull(); // late enough but only 40 m
    const b = nextPoliteAnnouncement(a, dist(250), 15_000);
    expect(b?.text).toBe(dist(250));
    expect(nextPoliteAnnouncement(b!, dist(190), 20_000)).toBeNull();
    expect(nextPoliteAnnouncement(b!, dist(200), 30_000)?.text).toBe(dist(200));
  });

  it("treats a distance to another stop as a new message", () => {
    const a = nextPoliteAnnouncement(null, dist(300), 0)!;
    const other = "≈ 290 m to Del Rosario (B1) in a straight line";
    expect(nextPoliteAnnouncement(a, other, 1)?.text).toBe(other);
  });

  it("lets a proposal or a stop count through at once, then throttles distances from there", () => {
    const a = nextPoliteAnnouncement(null, dist(300), 0)!;
    const near = nextPoliteAnnouncement(a, "You look close to Plaza Rizal (A1). Tap “I'm at the stop” when you're there.", 2_000)!;
    expect(near.text).toMatch(/^You look close/);
    expect(nextPoliteAnnouncement(near, "2 stops to go", 3_000)?.text).toBe("2 stops to go");
    expect(nextPoliteAnnouncement(near, "1 stop to go", 3_000)?.text).toBe("1 stop to go");
  });

  it("never announces more than one distance per 15 s, whatever the sequence (property)", () => {
    let rng = 20261016;
    const rand = () => ((rng = (rng * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    let prev = null as ReturnType<typeof nextPoliteAnnouncement>;
    let lastDistanceAt = -Infinity;
    let lastDistance = 0;
    let now = 0;
    for (let i = 0; i < 2000; i += 1) {
      now += Math.floor(rand() * 4000);
      const m = Math.floor(rand() * 600);
      const next = nextPoliteAnnouncement(prev, dist(m), now);
      if (next) {
        if (prev && walkDistanceOf(prev.text) !== null) {
          expect(now - lastDistanceAt).toBeGreaterThanOrEqual(DISTANCE_ANNOUNCE_MS);
          expect(Math.abs(m - lastDistance)).toBeGreaterThanOrEqual(DISTANCE_ANNOUNCE_M);
        }
        lastDistanceAt = now;
        lastDistance = m;
        prev = next;
      }
    }
  });
});
