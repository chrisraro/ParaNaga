// Planner copy rules (plan E §B, §E): labels and route-note selection.
import { describe, expect, it } from "vitest";
import { PLAN_LABELS } from "@/domain/planner/labels";
import { FLAGGED_PATH_NOTE, rideNotes } from "@/domain/planner/notes";
import { at } from "../fixtures/synthetic/planner-network";

const note = (text: string, near: { lat: number; lng: number; radiusM: number } | null) => ({ text, evidence: "community" as const, sourceCodes: ["SYN"], near });

describe("PLAN_LABELS", () => {
  it("are Recommended, Fewest transfers, Least walking and Short local ride", () => {
    expect(PLAN_LABELS).toEqual(["Recommended", "Fewest transfers", "Least walking", "Short local ride"]);
  });
});

describe("rideNotes", () => {
  const notes = [note("general", null), note("near", { ...at(0, 0), radiusM: 450 })];

  it("a near note applies within its radius of any given point; general notes always; near first", () => {
    expect(rideNotes(notes, [at(2000, 0), at(0, 440)], false)).toEqual(["near", "general"]);
    expect(rideNotes(notes, [at(2000, 0), at(0, 460)], false)).toEqual(["general"]);
  });

  it("adds the flagged-path note last", () => {
    expect(rideNotes([], [at(0, 0)], true)).toEqual([FLAGGED_PATH_NOTE]);
    expect(FLAGGED_PATH_NOTE.length).toBeGreaterThan(0);
  });
});
