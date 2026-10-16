// @vitest-environment jsdom
// Word budgets (U3): the commuting screens carry only what the rider needs to choose and follow a
// trip, so copy cannot bloat again. A "word" is a space-separated token with a letter or digit
// ("18–27" and "₱14–₱17" are one word each; "·", "+", "≈" and "—" are not). Screen-reader-only text
// is not counted (it is not visible); buttons are left out of the guidance step (they are controls,
// not explanation), but an option card is itself one button, so its whole text counts.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLinesForTests } from "@/client/network/use-lines";
import { resetPrefs } from "@/client/prefs/use-prefs";
import type { PlanResponse } from "@/domain/api/plan";
import type { UseGuidanceSession } from "@/client/guidance/use-guidance-session";
import { startSession } from "@/domain/guidance/session";
import { guidanceView } from "@/domain/guidance/view";
import { enrichPlan } from "@/domain/trip/enrich";
import { Guidance } from "@/ui/guidance/guidance";
import { TripDetail } from "@/ui/trip/trip-detail";
import { TripOptions } from "@/ui/trip/trip-options";
import { PROVISIONAL_PLAN } from "../e2e/fixtures/plan-responses";
import { ETA_MODEL, manila } from "./eta-fixtures";
import { ORIGIN, oneRide, tripOf } from "./guidance-fixtures";

vi.mock("@/client/saved/use-saved-trip-toggle", () => ({
  useSavedTripToggle: () => ({ match: null, kind: "none", waiting: false, unavailable: false, toggle: async () => undefined }),
}));

export const CARD_WORDS = 14;
export const DETAIL_HEADER_WORDS = 16;
export const GUIDANCE_WALK_WORDS = 22;

function visibleWords(el: Element, { skipButtons = false }: { skipButtons?: boolean } = {}): number {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(skipButtons ? ".sr-only, [hidden], button" : ".sr-only, [hidden]").forEach((n) => n.remove());
  return (clone.textContent ?? "").split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}

beforeEach(() => {
  window.localStorage.clear();
  resetPrefs();
  resetLinesForTests();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(manila("09:30"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const plan = PROVISIONAL_PLAN as unknown as PlanResponse;

describe("copy budgets", () => {
  it("an option card shows at most 14 words and says the essentials", () => {
    const data = enrichPlan(plan, null, { walkGraphStatus: "skipped" });
    render(<TripOptions data={data} onOpen={() => undefined} etaModel={ETA_MODEL} />);
    const cards = screen.getAllByTestId("trip-option");
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(visibleWords(card)).toBeLessThanOrEqual(CARD_WORDS);
    const first = cards[0]!;
    // Estimates stay ranges, the wait stays unknown, the caution stays; no leg-by-leg text, source or revision.
    expect(first.textContent).toMatch(/Est\.Estimate \d+–\d+ min \+ waiting \(unknown\)/);
    expect(first.textContent).toMatch(/Est\.Estimate ₱\d+(–₱\d+)?/);
    expect(first.textContent).toContain("Unverified route");
    expect(first.textContent).not.toMatch(/revision|Source|OpenStreetMap|Mapped candidate|Walk ≈|Signboard/);
    expect(first.querySelector('abbr[title="Estimate"]')).not.toBeNull();
  });

  it("the trip detail header shows at most 16 words", () => {
    const data = enrichPlan(plan, null, { walkGraphStatus: "skipped" });
    const start = { label: "Start", point: { lat: 13.62, lng: 123.18 }, source: "map" as const };
    const destination = { label: "SM City Naga", point: { lat: 13.63, lng: 123.19 }, source: "map" as const };
    render(<TripDetail data={data} option={data.plan.options[0]!} onBack={() => undefined} etaModel={ETA_MODEL} ends={{ start, destination }} onStart={() => undefined} />);
    expect(visibleWords(screen.getByTestId("trip-detail-header"))).toBeLessThanOrEqual(DETAIL_HEADER_WORDS);
    expect(screen.getByTestId("how-times-estimated-btn").textContent).toBe("How times are estimated");
    expect(screen.getByTestId("unverified-badge").textContent).toBe("Unverified route — confirm with the driver");
  });

  it("the first guidance walk step shows at most 22 words, keeps the badge and the manual button", () => {
    const now = 1_000_000;
    const s = startSession(tripOf(oneRide()), now);
    const g: UseGuidanceSession = {
      session: s,
      card: null,
      view: guidanceView(s, { lat: ORIGIN.lat, lng: ORIGIN.lng, accuracy: 10, timestamp: now }, now),
      now,
      location: { state: "watching", fix: null, watching: false },
      start: vi.fn(),
      send: vi.fn(),
      enableLocation: vi.fn(),
    };
    render(<Guidance guidance={g} covered={false} onEnd={vi.fn()} onDone={vi.fn()} onReplan={vi.fn()} />);
    const step = screen.getByTestId("guidance-walk");
    expect(visibleWords(step, { skipButtons: true })).toBeLessThanOrEqual(GUIDANCE_WALK_WORDS);
    expect(screen.getByTestId("unverified-badge").textContent).toBe("Unverified route — confirm with the driver");
    expect(screen.getByTestId("guidance-atStop").textContent).toBe("I'm at the stop");
  });
});
