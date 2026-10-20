// Increment F, T6: the pure helpers behind the new cards, and the access option in share text, offline
// steps and guidance (a tricycle step that is not the last one). No minutes for a tricycle anywhere.
import { describe, expect, it } from "vitest";
import { planResponseSchema, type PlanOptionDto, type PlanResponse } from "@/domain/api/plan";
import { currentStep, parseSession, reduceSession, serializeSession, startSession } from "@/domain/guidance/session";
import { guidanceSteps } from "@/domain/guidance/steps";
import { guidanceView } from "@/domain/guidance/view";
import { shareText, tripCardMeta, type SavedTrip } from "@/domain/saved/saved";
import { savedTripSteps } from "@/domain/saved/trip-text";
import {
  FARE_NOT_FIXED,
  accessTricycleChip,
  farNoteView,
  isAccessOption,
  isSpecialTrip,
  specialFareText,
  streetCardView,
  viaChipText,
} from "@/domain/trip/option-card";
import { optionTitle } from "@/domain/trip/present";
import { ACCESS_PLAN, SPECIAL_ONLY_PLAN, SPECIAL_TRIP_PLAN, VIA_PLAN } from "../e2e/fixtures/plan-responses";
import { ETA_MODEL, manila } from "./eta-fixtures";

const parse = (plan: unknown) => planResponseSchema.parse(plan) as PlanResponse;
const access = parse(ACCESS_PLAN).plan.options[0]!;
const special = parse(SPECIAL_ONLY_PLAN).plan.options[0]!;
const [r2, r3] = parse(VIA_PLAN).plan.options;
const mixedJeepney = parse(SPECIAL_TRIP_PLAN).plan.options[0]!;

describe("option kinds", () => {
  it("the special-trip flag survives the schema", () => {
    expect(special.specialTrip).toBe(true);
    expect(access.specialTrip).toBeUndefined();
  });

  it("tells the access option, the special trip and a plain jeepney apart", () => {
    expect([isAccessOption(access), isSpecialTrip(access)]).toEqual([true, false]);
    expect([isAccessOption(special), isSpecialTrip(special)]).toEqual([false, true]);
    expect([isAccessOption(mixedJeepney), isSpecialTrip(mixedJeepney)]).toEqual([false, false]);
  });

  it("an ordinary tricycle (the city proper) is not a special trip; an old body without the flag parses", () => {
    const { specialTrip: _flag, ...o } = special;
    void _flag;
    expect(isSpecialTrip(o as PlanOptionDto)).toBe(false);
    expect(specialFareText(o)).toBeNull();
  });
});

describe("via chip", () => {
  it("is 'via {label}' from the option, nothing without a via", () => {
    const bare = (o: PlanOptionDto) => ({ ...o, legs: o.legs.map((l) => (l.kind === "ride" ? { ...l, display: null } : l)) });
    expect(viaChipText(bare(r2!))).toBe("via Magsaysay");
    expect(viaChipText(bare(r3!))).toBe("via Roxas (Diversion)");
    // The title already names the street: no second mention.
    expect(viaChipText(r2!)).toBeNull();
    expect(viaChipText(r3!)).toBeNull();
    expect(viaChipText(mixedJeepney)).toBeNull();
  });
});

describe("fare texts", () => {
  it("access: 'From' the ride minimum plus PHP 15, never a range or a maximum", () => {
    expect(specialFareText(access)).toBe("From ₱33");
    expect(specialFareText({ ...access, fare: { ...access.fare, minCentavos: null, status: "unavailable" } })).toBeNull();
  });
  it("special trip: fare not fixed", () => {
    expect(specialFareText(special)).toBe(FARE_NOT_FIXED);
  });
  it("the tricycle part of the access card states the minimum and asks to confirm", () => {
    expect(accessTricycleChip(access)).toBe("Tricycle min ₱15 · confirm with the driver");
    const noFare: PlanOptionDto = { ...access, legs: access.legs.map((l) => (l.kind === "tricycle" ? { ...l, fare: { ...l.fare, minCentavos: null, status: "unavailable" as const } } : l)) };
    expect(accessTricycleChip(noFare)).toBe("Tricycle fare not available · confirm with the driver");
  });
});

describe("titles and notes", () => {
  it("the access option is 'Tricycle, then Jeep' with the ride's letter and title", () => {
    expect(optionTitle(access)).toBe("Tricycle, then Jeep I Centro-Pacol");
    expect(optionTitle(r2!)).toBe("E Centro-Del Rosario via Magsaysay Ave");
  });

  it("splits the far note into its evidence label and a capitalised sentence", () => {
    const base = "Local report: tricycles to Pacol charge special-trip fares, so we point you to the jeepney terminal instead.";
    const text = "Tricycles to Pacol charge special-trip fares, so we point you to the jeepney terminal instead.";
    expect(farNoteView(base)).toEqual({ label: "Local report", text });
    expect(farNoteView(base, [mixedJeepney])!.text).toBe(text);
    expect(farNoteView(base, [mixedJeepney, special])!.text).toBe(`${text} A special-trip tricycle is listed only if you still want one.`);
    expect(farNoteView(base, [access])!.text).toBe(text);
    expect(farNoteView("Something else")).toEqual({ label: null, text: "Something else" });
    expect(farNoteView(null)).toBeNull();
  });

  it("the special-trip card lines come from the planner notes, in order", () => {
    const leg = special.legs[0]!;
    if (leg.kind !== "tricycle") throw new Error("tricycle");
    expect(streetCardView(leg).specialNotes).toEqual(["Special trip · fare not fixed", "From Balatas Tricycle Terminal: local report, unconfirmed"]);
  });
});

describe("share text and offline steps for the access option", () => {
  const START = { label: "Naga Cathedral", point: { lat: 13.605, lng: 123.187 } };
  const END = { label: "Pacol", point: { lat: 13.6575, lng: 123.2475 } };
  const input = (option: PlanOptionDto) => ({ start: START, destination: END, option, stops: [], variants: [], revisionLabel: "far" });

  it("names the loading point, the minimum fare citation and the from-fare, with no tricycle minutes", () => {
    const text = shareText(input(access), { etaModel: ETA_MODEL, departure: manila("09:30") });
    expect(text).toContain("1. Take a tricycle to Jeepney station to Pacol · about 2.9 km along streets · minimum fare ₱15 (Ordinance 2024-002) · confirm with the driver");
    expect(text).toContain("Fare: From ₱33 (jeepney fare estimate plus the tricycle minimum; no maximum)");
    expect(text).toContain("tricycle time not estimated");
    expect(text).toContain("Unverified route");
    expect(text).not.toMatch(/Take a tricycle to Pacol/);
  });

  it("the special trip shares as 'Fare not fixed'", () => {
    const text = shareText(input(special));
    expect(text).toContain("Fare: Fare not fixed");
    expect(text).not.toContain("unavailable");
  });

  it("the offline steps follow the guidance steps", () => {
    const steps = savedTripSteps({ ...input(access), destination: END } as unknown as SavedTrip);
    expect(steps[0]).toBe("Take a tricycle to Jeepney station to Pacol · about 2.9 km along streets · minimum fare ₱15 (Ordinance 2024-002) · confirm with the driver.");
    expect(steps).toHaveLength(4);
  });

  it("the saved card meta shows the from-fare and the special trip's fare not fixed", () => {
    const meta = (option: PlanOptionDto) => tripCardMeta({ option, publishedAt: "2026-10-16T08:27:21.544Z", revisionLabel: "far" }, ETA_MODEL, manila("09:30"));
    expect(meta(access)).toContain("· From ₱33 ·");
    expect(meta(special)).toContain("· Fare not fixed ·");
  });
});

describe("guidance for the access option", () => {
  const trip = () => ({ option: access, stops: [], variants: [], destinationLabel: "Pacol", etaModel: ETA_MODEL });
  const steps = guidanceSteps(trip());

  it("a plain tricycle trip still names the destination and skips the ordinance", () => {
    const only = guidanceSteps({ option: special, stops: [], variants: [], destinationLabel: "Pacol" })[0]!;
    if (only.kind !== "street_ride") throw new Error("street");
    expect(only.text).toMatch(/^Take a tricycle to Pacol · /);
    expect(only.text).not.toContain("Ordinance");
  });

  it("'I got off the tricycle' goes on to the walk; it does not end the trip", () => {
    let s = startSession(trip(), 1_000);
    expect(currentStep(s).kind).toBe("street_ride");
    const view = guidanceView(s, null, 1_000);
    if (view.screen !== "street_ride") throw new Error("street screen");
    expect(view.title).toBe("Take a tricycle to Jeepney station to Pacol");
    expect(view.stepLabel).toBe(`Step 1 of ${steps.length} · Tricycle`);
    expect(view.actions[0]!.label).toBe("I got off the tricycle");
    expect(view.remainingTime).toBe("Tricycle time not estimated");

    s = reduceSession(s, { type: "arrived" });
    expect(s.status).toBe("active");
    expect(currentStep(s).kind).toBe("walk_to_board");
    expect(s.ride).toBeNull();
  });

  it("back from the walk returns to the tricycle step with no ride state; the trip stays consistent", () => {
    let s = reduceSession(startSession(trip(), 1_000), { type: "arrived" });
    s = reduceSession(s, { type: "back" });
    expect(currentStep(s).kind).toBe("street_ride");
    expect(s.ride).toBeNull();
    expect(reduceSession(s, { type: "back" })).toBe(s);
  });

  it("a stored session survives a reload on either side of the tricycle step", () => {
    const first = startSession(trip(), 1_000);
    const second = reduceSession(first, { type: "arrived" });
    for (const s of [first, second]) expect(parseSession(serializeSession(s), 2_000)?.stepIndex).toBe(s.stepIndex);
  });

  it("a plain tricycle trip still ends on 'I've arrived'", () => {
    const s = startSession({ option: special, stops: [], variants: [], destinationLabel: "Pacol" }, 1_000);
    const view = guidanceView(s, null, 1_000);
    if (view.screen !== "street_ride") throw new Error("street screen");
    expect(view.actions[0]!.label).toBe("I've arrived");
    expect(reduceSession(s, { type: "arrived" }).status).toBe("arrived");
  });
});
