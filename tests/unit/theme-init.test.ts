// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PREFS_STORAGE_KEY, THEMES, serializePrefs, DEFAULT_PREFS } from "@/domain/prefs/prefs";
import { applyDocumentPrefs } from "@/client/prefs/use-prefs";

// public/theme-init.js runs before the first paint; it must agree with the app's own reading of
// the preferences (applyDocumentPrefs, used after hydration and on every change).
const SCRIPT = readFileSync(path.resolve("public/theme-init.js"), "utf8");
const runThemeInit = () => new Function(SCRIPT)();

const root = () => document.documentElement;
const attrs = () => ({ theme: root().getAttribute("data-theme"), contrast: root().getAttribute("data-contrast") });

afterEach(() => {
  localStorage.clear();
  root().removeAttribute("data-theme");
  root().removeAttribute("data-contrast");
});

describe("public/theme-init.js", () => {
  it("reads the same storage key as the app", () => {
    expect(SCRIPT).toContain(`"${PREFS_STORAGE_KEY}"`);
  });

  it("sets data-theme and data-contrast for every preference", () => {
    for (const theme of THEMES) {
      for (const highContrast of [false, true]) {
        const prefs = { ...DEFAULT_PREFS, theme, highContrast };
        localStorage.setItem(PREFS_STORAGE_KEY, serializePrefs(prefs));
        root().setAttribute("data-contrast", "more"); // stale value from before: must be cleared
        runThemeInit();
        const fromScript = attrs();
        expect(fromScript).toEqual({ theme, contrast: highContrast ? "more" : null });

        applyDocumentPrefs(prefs);
        expect(attrs(), "the app applies the same attributes").toEqual(fromScript);
      }
    }
  });

  it("falls back to System and normal contrast without data or with bad data", () => {
    for (const raw of [null, "{", "null", '"dark"', JSON.stringify({ theme: "sepia", highContrast: "yes" })]) {
      if (raw === null) localStorage.removeItem(PREFS_STORAGE_KEY);
      else localStorage.setItem(PREFS_STORAGE_KEY, raw);
      runThemeInit();
      expect(attrs(), String(raw)).toEqual({ theme: "system", contrast: null });
    }
  });

  it("survives blocked storage", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    try {
      expect(runThemeInit).not.toThrow();
      expect(attrs()).toEqual({ theme: "system", contrast: null });
    } finally {
      Object.defineProperty(window, "localStorage", original);
    }
  });
});
