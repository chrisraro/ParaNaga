// @vitest-environment jsdom
// Ride naming (revision 2026-10-20): letter + title, title alone, two rides in order; tricycle terminal lines.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { tricycleTerminalCardLines, tricycleTerminalLines } from "@/domain/trip/option-card";
import { optionTitle, routeChipLabel } from "@/domain/trip/present";
import { LoopChip } from "@/ui/trip/trip-parts";

afterEach(cleanup);

const E = { letter: "E", title: "Centro-Del Rosario via Magsaysay Ave" };
const NO_LETTER = { letter: null, title: "Centro-Francia-San Felipe" };

describe("routeChipLabel with a display", () => {
  it("is letter + title, the title alone without a letter, and the old chip without a display", () => {
    expect(routeChipLabel("R2", "x", E)).toBe("E Centro-Del Rosario via Magsaysay Ave");
    expect(routeChipLabel("R5", "x", NO_LETTER)).toBe("Centro-Francia-San Felipe");
    expect(routeChipLabel("R8-A", "Centro–Magsaysay Loop A", null)).toBe("Loop A");
    expect(routeChipLabel("R2", "Centro–Del Rosario")).toBe("R2");
  });
  it("keeps a long title whole", () => {
    const title = "Centro-Bagumbayan-Magsaysay-Roxas Loop";
    expect(routeChipLabel("R8-C", "x", { letter: "C", title })).toBe(`C ${title}`);
  });
  it("names two rides in order", () => {
    const legs = [{ kind: "ride", routeCode: "R2", routeName: "x", display: E }, { kind: "walk" }, { kind: "ride", routeCode: "R5", routeName: "y", display: NO_LETTER }];
    expect(optionTitle({ rides: 2, walkEstimateMeters: 0, legs })).toBe("E Centro-Del Rosario via Magsaysay Ave + Centro-Francia-San Felipe");
  });
  it("the chip carries the same text", () => {
    render(<LoopChip leg={{ routeCode: "R2", routeName: "x", display: { ...E, unverified: true } }} />);
    expect(screen.getByText(/E Centro-Del Rosario via Magsaysay Ave/)).toBeTruthy();
  });
});

describe("tricycle terminal lines", () => {
  const t = (side: "origin" | "destination", name: string, distanceM: number, todas: string[] = []) => ({ side, code: name, name, distanceM, todas, source: "s" });
  it("detail: name and distance per side, TODA only when names are on file", () => {
    const lines = tricycleTerminalLines({ tricycleTerminals: [t("origin", "Balatas Tricycle Terminal", 63), t("destination", "Centro Terminal", 410, ["Centro TODA"])] });
    expect(lines.map((l) => l.text)).toEqual([
      "Tricycle terminal: Balatas Tricycle Terminal, about 60 m from your start",
      "Tricycle terminal: Centro Terminal, about 410 m from your destination",
    ]);
    expect(lines.map((l) => l.toda)).toEqual([null, "TODA: Centro TODA"]);
  });
  it("card: one short line, nothing about TODA when empty, nothing without terminals", () => {
    expect(tricycleTerminalCardLines({ tricycleTerminals: [t("origin", "Balatas Tricycle Terminal", 63)] })).toEqual({ terminal: "Terminal: Balatas Tricycle Terminal", toda: null });
    expect(tricycleTerminalCardLines({})).toEqual({ terminal: null, toda: null });
  });
});
