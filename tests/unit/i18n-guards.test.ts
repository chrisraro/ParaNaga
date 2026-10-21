// Translation guard tests (ADR 011, plan §1.7, task T3). Each check is a small function run on the
// real dictionaries and, once, on a broken fixture to prove it would catch the mistake.
// A missing Filipino key is a type error (`fil: Dict`), proven by the @ts-expect-error below.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { en, type DeepPartial, type Dict } from "@/i18n/dict";
import { fil } from "@/i18n/fil";
import { bcl } from "@/i18n/bcl";
import { BIKOL_ENABLED } from "@/i18n/locales";

type Leaf = string | ((...args: never[]) => string);
type Tree = { readonly [key: string]: Leaf | Tree | undefined };

/** Filipino strings allowed to equal the English, with the reason. */
const SAME_AS_EN: Record<string, string> = {
  "app.name": "brand",
  "acknowledgments.community": "pending verbatim-reviewed translation (T13)",
  "acknowledgments.driverReport": "pending verbatim-reviewed translation (T13)",
};

/** §6.5 per locale: no live/ETA/arrival/guarantee/official or e-jeep claims. bcl list comes from the reviewer. */
const BANNED: Record<"en" | "fil" | "bcl", RegExp[]> = {
  en: [/\blive\b/i, /\bETA\b/, /\barriving\b/i, /\bguaranteed\b/i, /e-jeep/i],
  fil: [/\blive\b/i, /\bETA\b/, /\bdarating\b/i, /\bparating\b/i, /\bgarantisado\b/i, /e-jeep/i, /e-dyip/i, /\bopisyal\b/i],
  bcl: [/\blive\b/i, /\bETA\b/, /e-jeep/i, /e-dyip/i],
};

function leaves(tree: Tree, prefix = ""): [string, Leaf][] {
  return Object.entries(tree).flatMap(([key, value]): [string, Leaf][] => {
    const at = prefix ? `${prefix}.${key}` : key;
    if (value === undefined) return [];
    return typeof value === "object" ? leaves(value, at) : [[at, value]];
  });
}

const missingKeys = (source: Tree, other: Tree) => {
  const have = new Set(leaves(other).map(([key]) => key));
  return leaves(source).map(([key]) => key).filter((key) => !have.has(key));
};

/** Calls every message function with sentinels; returns keys whose output lost one. */
function droppedPlaceholders(tree: Tree): string[] {
  return leaves(tree).flatMap(([key, leaf]) => {
    if (typeof leaf === "string") return [];
    const fn = leaf as (...args: unknown[]) => string;
    const strings = Array.from({ length: fn.length }, (_, i) => `⟦${i}⟧`);
    const numbers = Array.from({ length: fn.length }, (_, i) => 9870 + i);
    let out: string;
    let args: unknown[] = strings;
    try {
      out = fn(...strings);
    } catch {
      args = numbers;
      out = fn(...numbers);
    }
    return args.every((arg) => out.includes(String(arg))) ? [] : [key];
  });
}

/** Keys whose text is exactly the English one and not allow-listed. */
function untranslated(source: Tree, other: Tree, allow: Record<string, string>): string[] {
  const english = new Map(leaves(source));
  return leaves(other)
    .filter(([key, leaf]) => typeof leaf === "string" && leaf === english.get(key) && !(key in allow))
    .map(([key]) => key);
}

function bannedHits(tree: Tree, patterns: RegExp[]): string[] {
  return leaves(tree)
    .filter(([, leaf]) => typeof leaf === "string" && patterns.some((p) => p.test(leaf)))
    .map(([key]) => key);
}

type LedgerRow = { key: string; status: string };

/** Bikol may only be switched on when every key is drafted and native-approved in the ledger. */
function bikolGateProblems(enabled: boolean, source: Tree, bikol: Tree, ledger: LedgerRow[] | null): string[] {
  if (!enabled) return [];
  if (!ledger) return ["docs/i18n/ledger-bcl.json is missing"];
  const status = new Map(ledger.map((row) => [row.key, row.status]));
  return [
    ...missingKeys(source, bikol).map((key) => `${key}: no Bikol text`),
    ...leaves(source)
      .map(([key]) => key)
      .filter((key) => status.get(key) !== "native_approved")
      .map((key) => `${key}: not native_approved`),
  ];
}

const EN = en as Tree;
const FIL = fil as Tree;
const BCL = bcl as Tree;

describe("Filipino completeness", () => {
  it("is enforced by the type (a missing key does not compile)", () => {
    // @ts-expect-error: `acknowledgments` is missing, so this is not a Dict.
    const broken: Dict = { app: { name: "ParaNaga", tagline: "x" } };
    expect(missingKeys(EN, broken as Tree)).toEqual(["acknowledgments.community", "acknowledgments.driverReport"]);
  });

  it("has every English key", () => {
    expect(missingKeys(EN, FIL)).toEqual([]);
  });
});

describe("not just English", () => {
  it("flags a Filipino string copied from English", () => {
    const copied = { ...fil, app: { ...fil.app, tagline: en.app.tagline } };
    expect(untranslated(EN, copied as Tree, SAME_AS_EN)).toEqual(["app.tagline"]);
  });

  it("every Filipino string differs from English unless allow-listed", () => {
    expect(untranslated(EN, FIL, SAME_AS_EN)).toEqual([]);
  });

  it("the allow-list names only real keys that still match English", () => {
    const english = new Map(leaves(EN));
    const filipino = new Map(leaves(FIL));
    for (const key of Object.keys(SAME_AS_EN)) expect(filipino.get(key), key).toBe(english.get(key));
  });
});

describe("placeholders", () => {
  it("flags a message that drops an argument", () => {
    const broken = { stops: (n: number) => `${n} stops`, boarded: (chip: string) => `Nakasakay na ako${chip ? "" : "?"}` };
    expect(droppedPlaceholders(broken)).toEqual(["boarded"]);
  });

  it("every message function keeps its arguments in every locale", () => {
    for (const tree of [EN, FIL, BCL]) expect(droppedPlaceholders(tree)).toEqual([]);
  });
});

describe("§6.5 banned wording per locale", () => {
  it("flags a live/arrival claim", () => {
    expect(bannedHits({ a: "Darating ang jeep sa 2 min" }, BANNED.fil)).toEqual(["a"]);
  });

  it("no dictionary makes one", () => {
    expect(bannedHits(EN, BANNED.en)).toEqual([]);
    expect(bannedHits(FIL, BANNED.fil)).toEqual([]);
    expect(bannedHits(BCL, BANNED.bcl)).toEqual([]);
  });
});

describe("Bikol gate", () => {
  const partial: DeepPartial<Dict> = { app: { name: "ParaNaga" } };

  it("refuses Bikol enabled without a ledger, a key, or a native approval", () => {
    expect(bikolGateProblems(true, EN, BCL, null)).toEqual(["docs/i18n/ledger-bcl.json is missing"]);
    const ledger = leaves(EN).map(([key]) => ({ key, status: key === "app.name" ? "native_approved" : "needs_review" }));
    const problems = bikolGateProblems(true, EN, partial as Tree, ledger);
    expect(problems).toContain("app.tagline: no Bikol text");
    expect(problems).toContain("app.tagline: not native_approved");
    expect(bikolGateProblems(false, EN, partial as Tree, null)).toEqual([]);
  });

  it("holds for the shipped flag", () => {
    const file = path.resolve("docs/i18n/ledger-bcl.json");
    const ledger = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as LedgerRow[]) : null;
    expect(bikolGateProblems(BIKOL_ENABLED, EN, BCL, ledger)).toEqual([]);
  });
});
