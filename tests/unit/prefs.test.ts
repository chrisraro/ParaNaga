import { describe, expect, it } from "vitest";
import { DEFAULT_LAYERS_PREF, DEFAULT_PREFS, PREFS_STORAGE_KEY, parsePrefs, serializePrefs, type Prefs } from "@/domain/prefs/prefs";

describe("device preferences (Task 2 + Task 12 D16 layers)", () => {
  it("defaults: System theme, normal contrast, map background on, trip history off, layers D16 defaults", () => {
    expect(DEFAULT_PREFS).toEqual({
      theme: "system",
      highContrast: false,
      lowData: false,
      historyEnabled: false,
      layers: {
        routes: true,
        terminals: true,
        historical: false,
        modes: [],
      },
    });
    expect(PREFS_STORAGE_KEY).toBe("paranaga.prefs");
  });

  it("missing, empty or malformed JSON falls back to the defaults", () => {
    for (const raw of [null, "", "{", "not json", "null", "42", '"dark"', "[]", "true"]) {
      expect(parsePrefs(raw), String(raw)).toEqual(DEFAULT_PREFS);
    }
  });

  it("keeps valid fields and replaces each invalid one with its default", () => {
    expect(parsePrefs(JSON.stringify({ theme: "dark", highContrast: true, lowData: true, historyEnabled: true }))).toEqual({
      theme: "dark",
      highContrast: true,
      lowData: true,
      historyEnabled: true,
      layers: DEFAULT_LAYERS_PREF,
    });
    expect(parsePrefs(JSON.stringify({ theme: "purple", highContrast: "yes", lowData: true }))).toEqual({
      ...DEFAULT_PREFS,
      lowData: true,
    });
    // Unknown keys (a units or language setting from somewhere else) are dropped.
    expect(parsePrefs(JSON.stringify({ theme: "light", units: "imperial", language: "fil" }))).toEqual({ ...DEFAULT_PREFS, theme: "light" });
  });

  it("parses and validates layers preference (D16), dropping invalid modes", () => {
    const parsed = parsePrefs(
      JSON.stringify({
        layers: {
          routes: false,
          terminals: true,
          historical: true,
          modes: ["tricycle", "invalid_mode", "jeepney", "tricycle"],
        },
      }),
    );
    expect(parsed.layers).toEqual({
      routes: false,
      terminals: true,
      historical: true,
      modes: ["tricycle", "jeepney"],
    });
  });

  it("round-trips through serializePrefs", () => {
    const prefs: Prefs = {
      theme: "light",
      highContrast: true,
      lowData: false,
      historyEnabled: true,
      layers: { routes: true, terminals: false, historical: true, modes: ["jeepney"] },
    };
    expect(parsePrefs(serializePrefs(prefs))).toEqual(prefs);
  });
});
