// The jeepney soft service window (plan E §E, E-J7): a constant, warn never hide, Manila clock only.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  JEEPNEY_SOFT_WINDOW,
  SERVICE_WINDOW_HINT,
  optionServiceWindowNote,
  serviceWindowNote,
} from "@/domain/eta/service-window";
import { manila } from "./eta-fixtures";
import { oneRide, streetOnly, walkOnly } from "./guidance-fixtures";

const OUTSIDE = "This ride starts outside the usual hours (about 5 am–9 pm, unconfirmed). A jeepney may not be running. Check with the driver or terminal.";

describe("serviceWindowNote (Manila clock)", () => {
  it("the window is a sourced constant, never a timetable", () => {
    expect(JEEPNEY_SOFT_WINDOW).toEqual({
      start: "05:00",
      end: "21:00",
      sourceCodes: ["RH08", "RH09", "RH01", "RH10", "U02"],
      basis: "Weak sources; no official timetable",
    });
    expect(SERVICE_WINDOW_HINT).toBe("Usually runs about 5:00-21:00 · unconfirmed");
  });

  it("04:30: outside, and some jeepneys reportedly start earlier", () => {
    expect(serviceWindowNote(manila("04:30"))).toEqual({ state: "before_start", hint: SERVICE_WINDOW_HINT, lines: [OUTSIDE, "Some jeepneys reportedly start before 5 am."] });
  });

  it("05:00 and midday: nothing to say", () => {
    expect(serviceWindowNote(manila("05:00"))).toBeNull();
    expect(serviceWindowNote(manila("12:00"))).toBeNull();
    expect(serviceWindowNote(manila("19:59"))).toBeNull();
  });

  it("20:30: last trips may have left", () => {
    expect(serviceWindowNote(manila("20:30"))).toEqual({ state: "last_trips", hint: SERVICE_WINDOW_HINT, lines: ["Last trips may already have left (unconfirmed)."] });
  });

  it("21:30 (and exactly 21:00): outside the usual hours", () => {
    for (const t of ["21:30", "21:00", "23:59"]) expect(serviceWindowNote(manila(t))).toEqual({ state: "after_end", hint: SERVICE_WINDOW_HINT, lines: [OUTSIDE] });
  });

  it("reads the Manila clock from the epoch: the same instant gives the same note whatever the host zone", () => {
    expect(serviceWindowNote(new Date("2026-10-16T13:30:00Z"))?.state).toBe("after_end"); // 21:30 Manila
    expect(serviceWindowNote(new Date("2026-10-16T20:30:00Z"))?.state).toBe("before_start"); // 04:30 Manila next day
  });

  it("an invalid clock gives no note (never a crash)", () => {
    expect(serviceWindowNote(new Date(Number.NaN))).toBeNull();
  });

  it("property: never a promise, never a duration, every line hedged", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 7 * 86_400_000 }), (ms) => {
        const n = serviceWindowNote(new Date(Date.UTC(2026, 9, 16) + ms));
        if (!n) return true;
        const text = [n.hint, ...n.lines].join(" ");
        return /unconfirmed|reportedly/.test(text) && !/\b(will|guarantee|official|exact|ETA|arriving)\b/i.test(text.replace("no official timetable", ""));
      }),
      { seed: 9, numRuns: 300 },
    );
  });
});

describe("optionServiceWindowNote", () => {
  it("only options with a jeepney ride carry the note; the option is never hidden", () => {
    expect(optionServiceWindowNote(oneRide(), manila("22:00"))?.state).toBe("after_end");
    expect(optionServiceWindowNote(walkOnly(), manila("22:00"))).toBeNull();
    expect(optionServiceWindowNote(streetOnly("tricycle"), manila("22:00"))).toBeNull();
    expect(optionServiceWindowNote(oneRide(), manila("09:00"))).toBeNull();
  });
});

describe("optionServiceWindowNote: jeepney rides only (review M4)", () => {
  it("a ride leg of another mode gets no jeepney window note", () => {
    const o = oneRide();
    const uv = { ...o, legs: o.legs.map((l) => (l.kind === "ride" ? { ...l, mode: "uv_express" as const } : l)) };
    expect(optionServiceWindowNote(uv, manila("22:00"))).toBeNull();
    expect(optionServiceWindowNote(streetOnly("padyak"), manila("04:00"))).toBeNull();
  });
});
