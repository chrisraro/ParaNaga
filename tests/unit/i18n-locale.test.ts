// @vitest-environment jsdom
// ADR 011, tasks T1/T2/T5: locale choice, prefs field, <html lang> before paint, dictionary
// fallback, and the Intl locale helper.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PREFS, PREFS_STORAGE_KEY, parsePrefs, serializePrefs } from "@/domain/prefs/prefs";
import { applyDocumentPrefs } from "@/client/prefs/use-prefs";
import { BIKOL_ENABLED, formatLocale, phoneLocale, resolveLocale } from "@/i18n/locales";
import { en, loadDict, mergeDict, type Dict } from "@/i18n/dict";
import { fil } from "@/i18n/fil";
import { publishedDateText } from "@/domain/network/present";
import { manilaDate, manilaDay } from "@/domain/reports/list";

const SCRIPT = readFileSync(path.resolve("public/theme-init.js"), "utf8");
const runThemeInit = () => new Function(SCRIPT)();
const realLanguages = navigator.languages;
const setPhone = (languages: readonly string[]) => Object.defineProperty(navigator, "languages", { value: languages, configurable: true });

afterEach(() => {
  localStorage.clear();
  setPhone(realLanguages);
  document.documentElement.lang = "";
});

describe("locale choice", () => {
  it("first open follows the phone: fil/tl → fil, Bikol only when enabled, else English", () => {
    expect(phoneLocale(["fil-PH"])).toBe("fil");
    expect(phoneLocale(["tl"])).toBe("fil");
    expect(phoneLocale(["en-US", "fil"])).toBe("en");
    expect(phoneLocale(["ja", "TL-ph"])).toBe("fil");
    expect(phoneLocale(["ja", "ko"])).toBe("en");
    expect(phoneLocale([])).toBe("en");
    expect(phoneLocale(["bcl", "en"])).toBe(BIKOL_ENABLED ? "bcl" : "en");
  });

  it("a saved choice overrides the phone language", () => {
    expect(resolveLocale("en", ["fil-PH"])).toBe("en");
    expect(resolveLocale("fil", ["en-US"])).toBe("fil");
    expect(resolveLocale(undefined, ["fil-PH"])).toBe("fil");
    if (!BIKOL_ENABLED) expect(resolveLocale("bcl", ["en"])).toBe("en");
  });

  it("maps every locale to an Intl locale with data (Bikol dates follow Filipino)", () => {
    expect([formatLocale("en"), formatLocale("fil"), formatLocale("bcl")]).toEqual(["en-PH", "fil-PH", "fil-PH"]);
  });
});

describe("prefs locale field", () => {
  it("is absent by default and round-trips when chosen", () => {
    expect(parsePrefs(null).locale).toBeUndefined();
    expect(JSON.parse(serializePrefs(DEFAULT_PREFS))).not.toHaveProperty("locale");
    expect(parsePrefs(serializePrefs({ ...DEFAULT_PREFS, locale: "fil" }))).toEqual({ ...DEFAULT_PREFS, locale: "fil" });
  });

  it("drops an unknown locale, and Bikol while it is hidden, without touching the other fields", () => {
    expect(parsePrefs(JSON.stringify({ theme: "dark", locale: "xx" }))).toEqual({ ...DEFAULT_PREFS, theme: "dark" });
    const bikol = parsePrefs(JSON.stringify({ theme: "dark", locale: "bcl" }));
    expect(bikol.locale).toBe(BIKOL_ENABLED ? "bcl" : undefined);
    expect(bikol.theme).toBe("dark");
  });
});

describe("<html lang> before paint", () => {
  it("theme-init.js mirrors BIKOL_ENABLED", () => {
    expect(SCRIPT).toContain(`var BIKOL = ${BIKOL_ENABLED};`);
  });

  it("theme-init.js and the app set the same lang for every choice and phone", () => {
    const phones = [["en-US"], ["fil-PH"], ["tl"], ["bcl", "fil"], ["ja"], []];
    for (const phone of phones) {
      for (const locale of [undefined, "en", "fil", "bcl", "xx"] as const) {
        setPhone(phone);
        const raw = JSON.stringify({ ...DEFAULT_PREFS, locale });
        localStorage.setItem(PREFS_STORAGE_KEY, raw);
        runThemeInit();
        const fromScript = document.documentElement.lang;
        expect(fromScript).toBe(resolveLocale(parsePrefs(raw).locale, phone));
        document.documentElement.lang = "";
        applyDocumentPrefs(parsePrefs(raw));
        expect(document.documentElement.lang, `${phone} / ${locale}`).toBe(fromScript);
      }
    }
  });

  it("falls back to English with no data or bad data", () => {
    setPhone(["ja"]);
    for (const raw of [null, "{", '"fil"']) {
      if (raw === null) localStorage.removeItem(PREFS_STORAGE_KEY);
      else localStorage.setItem(PREFS_STORAGE_KEY, raw);
      runThemeInit();
      expect(document.documentElement.lang).toBe("en");
    }
  });
});

describe("dictionaries", () => {
  it("loads English as-is and Filipino on demand", async () => {
    expect(await loadDict("en")).toBe(en);
    expect(await loadDict("fil")).toBe(fil);
  });

  it("a missing Bikol key falls back to Filipino (then English through Filipino's completeness)", async () => {
    const bcl = await loadDict("bcl");
    expect(bcl.app.tagline).toBe(fil.app.tagline);
    const partial = mergeDict<Dict>(fil, { app: { tagline: "Bikol" } });
    expect(partial.app).toEqual({ name: fil.app.name, tagline: "Bikol" });
    expect(partial.acknowledgments).toBe(fil.acknowledgments);
  });
});

describe("dates under formatLocale (T5)", () => {
  const at = "2026-10-21T02:00:00Z";
  it("stay English by default and switch to fil-PH for Filipino and Bikol", () => {
    expect(publishedDateText(at)).toBe("Oct 21, 2026");
    expect(publishedDateText(at, "fil")).toBe("Okt 21, 2026");
    expect(publishedDateText(at, "bcl")).toBe("Okt 21, 2026");
    expect(manilaDay(at, "fil")).toBe("Okt 21, 2026");
    expect(manilaDate(at, "fil")).toContain("Okt 21, 2026");
    expect(manilaDate(at)).toContain("Oct 21, 2026");
  });
});
