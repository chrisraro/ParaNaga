import { describe, expect, it } from "vitest";
import { historyDepth, screenState, stepOut, tabBarHidden, type ScreenFlags } from "@/ui/home/screen-state";

const none: ScreenFlags = { picking: false, ready: false, detail: false, guiding: false };

describe("screenState", () => {
  it("is home with no trip", () => {
    expect(screenState(none)).toBe("home");
    // one end alone is still the map
    expect(screenState({ ...none })).toBe("home");
  });
  it("is directions once both ends are set", () => {
    expect(screenState({ ...none, ready: true })).toBe("directions");
  });
  it("is detail when an option (or a saved trip) is open", () => {
    expect(screenState({ ...none, ready: true, detail: true })).toBe("detail");
  });
  it("is guidance while a session runs, over detail and directions", () => {
    expect(screenState({ ...none, ready: true, detail: true, guiding: true })).toBe("guidance");
    expect(screenState({ ...none, guiding: true })).toBe("guidance");
  });
  it("is picking while a pin is placed, over everything", () => {
    expect(screenState({ ...none, picking: true })).toBe("picking");
    expect(screenState({ picking: true, ready: true, detail: true, guiding: true })).toBe("picking");
  });
});

describe("tabBarHidden", () => {
  it("shows the tab bar only on home", () => {
    expect(tabBarHidden("home")).toBe(false);
    for (const s of ["picking", "directions", "detail", "guidance"] as const) expect(tabBarHidden(s)).toBe(true);
  });
});

describe("stepOut (Back / Escape order)", () => {
  it("steps guidance, detail, directions, then stops at home", () => {
    expect(stepOut("guidance")).toBe("end-guidance");
    expect(stepOut("detail")).toBe("close-detail");
    expect(stepOut("directions")).toBe("clear-trip");
    expect(stepOut("home")).toBeNull();
  });
  it("cancels a pin first", () => {
    expect(stepOut("picking")).toBe("cancel-pick");
  });
});

describe("historyDepth", () => {
  it("is one entry per state above home, ignoring a pin being placed", () => {
    expect(historyDepth(none)).toBe(0);
    expect(historyDepth({ ...none, ready: true })).toBe(1);
    expect(historyDepth({ ...none, ready: true, detail: true })).toBe(2);
    expect(historyDepth({ ...none, ready: true, detail: true, guiding: true })).toBe(3);
    expect(historyDepth({ ...none, guiding: true })).toBe(3);
    expect(historyDepth({ ...none, picking: true })).toBe(0);
    expect(historyDepth({ ...none, picking: true, ready: true })).toBe(1);
  });
});
