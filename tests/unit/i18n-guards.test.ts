// Translation guard tests (ADR 011, plan §1.7, task T3). Each check is a small function run on the
// real dictionaries and, once, on a broken fixture to prove it would catch the mistake.
// A missing Filipino key is a type error (`fil: Dict`), proven by the @ts-expect-error below.
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
  // Taglish words and proper nouns people say the same way in English (T9 draft; ledger-fil.json).
  "guidance.tricycle": "everyday word",
  "guidance.padyak": "everyday word",
  "guidance.saved": "Taglish, button length budget",
  "guidance.steps": "Taglish, button length budget",
  "guidance.undo": "Taglish, button length budget (T10 review: clearer than 'Bawi'; 'I-undo' is over)",
  "eta.modeName.uv_express": "proper name",
  "eta.modeName.bus": "everyday word",
  "eta.modeName.tricycle": "everyday word",
  "eta.modeName.padyak": "everyday word",
  "trip.direction.clockwise": "Taglish",
  "trip.direction.counterclockwise": "Taglish",
  "trip.kind.tricycle": "everyday word",
  "trip.kind.padyak": "everyday word",
  "trip.kindTitle.tricycle": "everyday word",
  "trip.kindTitle.padyak": "everyday word",
  "trip.saved": "Taglish, button length budget",
  "trip.save": "Taglish, button length budget",
  "trip.share": "Taglish, button length budget",
  "trip.roadside.chipCentroGenLuna": "place names",
  "trip.roadside.chipGenLunaElias": "place names",
  "trip.allOptionsClose": "punctuation",
  "shell.tabs.saved": "Taglish, tab length budget",
  "kit.badges.osm": "brand",
  "kit.osmAttribution": "legal attribution",
  // P2 screens (T12).
  "modes.display.tricycle": "everyday word (Taglish vehicle names)",
  "modes.display.bus": "everyday word (Taglish vehicle names)",
  "modes.name.tricycle": "everyday word (Taglish vehicle names)",
  "modes.name.bus": "everyday word (Taglish vehicle names)",
  "modes.chip.bus": "everyday word (Taglish vehicle names)",
  "modes.chip.traditional_puj": "everyday word (Taglish vehicle names)",
  "modes.chip.tricycle": "everyday word (Taglish vehicle names)",
  "modes.chip.unconfirmed": "everyday word (Taglish vehicle names)",
  "terminals.modeLabel.bus": "everyday word (Taglish vehicle names)",
  "terminals.modeLabel.tricycle": "everyday word (Taglish vehicle names)",
  "terminals.modeLabel.van": "everyday word (Taglish vehicle names)",
  "map.announceTricycle": "everyday word (Taglish vehicle names)",
  "map.announcePadyak": "everyday word (Taglish vehicle names)",
  "map.chipPadyak": "everyday word (Taglish vehicle names)",
  "map.legendPadyak": "everyday word (Taglish vehicle names)",
  "modes.display.uv_express": "proper name",
  "modes.chip.uv_express": "proper name",
  "modes.name.uv_express": "proper name",
  "terminals.modeLabel.uv_express": "proper name",
  "modes.chip.modern_puj": "Taglish, chip length budget",
  "modes.chip.mixed_trad_modern": "Taglish, chip length budget",
  "modes.chip.e_tricycle": "Taglish, chip length budget",
  "modes.display.e_tricycle": "everyday word (e-tricycle is a product name)",
  "detail.terminal": "everyday English loanword",
  "terminals.kind.terminal": "everyday English loanword",
  "places.barangay": "everyday English loanword",
  "places.category.atm": "everyday English loanword",
  "places.category.cafe": "everyday English loanword",
  "places.category.convenience_store": "everyday English loanword",
  "places.category.department_store": "everyday English loanword",
  "places.category.fast_food": "everyday English loanword",
  "places.category.hotel": "everyday English loanword",
  "places.category.mall": "everyday English loanword",
  "places.category.restaurant": "everyday English loanword",
  "places.category.square": "everyday English loanword",
  "places.category.supermarket": "everyday English loanword",
  "map.legend": "everyday English loanword",
  "map.zoom": "everyday English loanword",
  "settings.fareRegular": "everyday English loanword",
  "settings.highContrast": "everyday English loanword",
  "settings.lowData": "everyday English loanword",
  "settings.roleCommuter": "everyday English loanword",
  "settings.title": "everyday English loanword",
  "saved.title": "Taglish, tab/button length budget (matches shell.tabs.saved)",
  "saved.savedState": "Taglish, tab/button length budget (matches shell.tabs.saved)",
  "saved.undo": "Taglish, tab/button length budget (matches shell.tabs.saved)",
  "search.group.saved": "Taglish, tab/button length budget (matches shell.tabs.saved)",
  "pwa.pageSaved": "Taglish, tab/button length budget (matches shell.tabs.saved)",
  "saved.availableOffline": "Taglish, common phone wording",
  "pwa.installAppRow": "Taglish, common phone wording",
  "pwa.installGroup": "Taglish, common phone wording",
  "pwa.ipad": "device name",
  "pwa.iphone": "device name",
  "saved.placeSource.osm": "brand",
  // Landing page (T14).
  "landing.ride.padyak.title": "everyday word (Taglish vehicle names)",
  "landing.offline.android.device": "device and browser names",
  "landing.offline.iphone.device": "device and browser names",
  "landing.footer.osm": "legal attribution (OpenStreetMap contributors)",
  // P3 screens (T13).
  ...Object.fromEntries(
    Object.keys(en.sources.verbatim).map((key) => [
      `sources.verbatim.${key}`,
      "data basis, licence and attribution text: English verbatim until a verbatim-reviewed translation (ledger note)",
    ]),
  ),
  "help.dataGroup": "everyday English loanword",
  "report.statuses.draft": "everyday English loanword",
  "driverReport.bodyName": "everyday word (jeepney body number)",
  "driverReport.summary.body": "everyday word (jeepney body number)",
  "reports.facts.body": "everyday word (jeepney body number)",
  "driverReport.summary.operator": "everyday English loanword",
  "reports.facts.operator": "everyday English loanword",
  "mynaga.panelTitle": "brand",
  "community.postTitle": "everyday English loanword (Taglish 'post')",
  // T15: one "Saved" family. A standalone tab, filter or state label is "Saved" (as shell.tabs.saved);
  // inside a phrase it is "naka-save".
  "community.scopes.saved": "Taglish, tab/button length budget (matches shell.tabs.saved)",
  "community.saved": "Taglish, tab/button length budget (matches shell.tabs.saved)",
  "auth.emailLabel": "everyday English loanword",
};

/** Buttons and chips (§1.7 #6): a translation may be at most 1.35 × the English length. */
const SHORT = [
  "guidance.endGuidance", "guidance.atStop", "guidance.boarded", "guidance.arrived", "guidance.gotOffTricycle", "guidance.paraAck",
  "guidance.gotOff", "guidance.gotOffEarly", "guidance.missedStop", "guidance.done", "guidance.undo", "guidance.stepLabel",
  "guidance.useLocation", "guidance.reportDriver", "guidance.keepGoing", "guidance.replan", "guidance.saveTrip", "guidance.saved",
  "guidance.recenter", "guidance.steps",
    "geo.accuracy", "eta.estAbbr", "eta.close", "trip.unverifiedChip", "trip.unverified", "trip.fareNone", "trip.fareNA",
    "trip.fareFrom", "trip.fareNotFixed", "trip.noTransfers", "trip.oneTransfer", "trip.tryAgain", "trip.changeEnds",
    "trip.recommended", "trip.allOptions", "trip.save", "trip.saved", "trip.updateSaved", "trip.share", "trip.startTrip",
    "trip.showOnMap", "trip.kindTitle.tricycle", "trip.kindTitle.padyak", "trip.roadside.chipWestCentro",
    "trip.roadside.chipEastDiversion", "trip.roadside.chipEastOutbound", "trip.roadside.chipNorthMagsaysay",
    "trip.roadside.chipSouthCentro", "trip.roadside.chipOutboundDelRosario", "trip.roadside.chipNorthOutbound",
    "trip.roadside.chipEastDelRosario", "trip.roadside.chipCentroGenLuna", "trip.roadside.chipGenLunaElias",
    "trip.roadside.chipCentroTerminal", "trip.roadside.chipCounterclockwise", "trip.roadside.chipClockwise", "home.start",
    "home.destination", "home.chooseStart", "home.whereTo", "home.useCurrentLocation", "home.chooseOnMap", "home.setStartHere",
    "home.setDestinationHere", "home.cancel", "home.clearTrip", "home.moveStartPin", "home.setStart", "home.setDestination",
    "home.chooseStartOnMap", "home.chooseDestinationOnMap", "home.clearStart", "home.clearDestination", "shell.tabs.map",
    "shell.tabs.explore", "shell.tabs.saved", "shell.tabs.community", "shell.tabs.more", "shell.back", "kit.cancel",
    "kit.badges.verified", "kit.badges.candidate", "kit.badges.documented", "kit.badges.not-surveyed",
    "kit.badges.provisional-stops", "kit.badges.osm", "kit.badges.approximate-path",
];
const SHORT_FACTOR = 1.35;

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

/** Keys whose text (or message function) is exactly the English one and not allow-listed. */
function untranslated(source: Tree, other: Tree, allow: Record<string, string>): string[] {
  const english = new Map(leaves(source));
  return leaves(other)
    .filter(([key, leaf]) => leaf === english.get(key) && !(key in allow))
    .map(([key]) => key);
}

/** A leaf as text: a message function is called with short sentinels. */
const sample = (leaf: Leaf) => (typeof leaf === "string" ? leaf : (leaf as (...args: unknown[]) => string)(...Array.from({ length: leaf.length }, () => "X")));

/** `short` keys whose translation is longer than SHORT_FACTOR × the English. */
function tooLong(source: Tree, other: Tree, short: string[]): string[] {
  const english = new Map(leaves(source));
  const translated = new Map(leaves(other));
  return short.filter((key) => {
    const leaf = translated.get(key);
    return leaf !== undefined && sample(leaf).length > SHORT_FACTOR * sample(english.get(key)!).length;
  });
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
    expect(missingKeys(EN, broken as Tree)).toEqual(leaves(EN).map(([key]) => key).filter((key) => !key.startsWith("app.")));
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

describe("length budget for buttons and chips", () => {
  it("flags a button that grew past the budget", () => {
    const long = { guidance: { ...fil.guidance, done: "Tapos na ang lahat ng hakbang" } };
    expect(tooLong(EN, long as Tree, ["guidance.done"])).toEqual(["guidance.done"]);
  });

  it("every short key is a real key and fits in every locale", () => {
    const english = new Map(leaves(EN));
    for (const key of SHORT) expect(english.has(key), key).toBe(true);
    expect(tooLong(EN, FIL, SHORT)).toEqual([]);
    expect(tooLong(EN, BCL, SHORT)).toEqual([]);
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

describe("no sentence hard-coded in the saved client code", () => {
  it("user-facing lines live in the dictionaries", () => {
    const dir = path.join(process.cwd(), "src/client/saved");
    for (const file of readdirSync(dir)) {
      const lines = readFileSync(path.join(dir, file), "utf8").split(String.fromCharCode(10));
      const code = lines.filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join(" ");
      expect(code, file).not.toMatch(/"[A-Z][a-z]+( [a-z]+)+\."/);
    }
  });
});
