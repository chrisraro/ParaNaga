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

/** Guidance keys still English in `fil` until the T9 draft + Jev check fills them (strings and message functions). */
const PENDING_T9 = [
  "keepOpen", "endGuidance", "atStop", "boarded", "arrived", "gotOffTricycle", "paraAck", "gotOff", "gotOffEarly", "missedStop",
  "done", "boardingSideUnknown", "signboardUnknown", "entranceUnknown", "locationApproximate", "locationStale", "locationImprecise",
  "noMarkedStops", "offPath", "metresLeft", "getReady", "headsUp", "arriveNear", "stopsByPinOrder", "paraTitle", "paraBody",
  "paraAckTitle", "paraAckBody", "stopIsNext", "arrivedTitle", "arrivedBody", "undo", "missedTitle", "missedBody", "earlyTitle",
  "earlyBody", "stepLabel", "arriveStepLabel", "stepWalk", "stepRide", "stepTransfer", "tricycle", "padyak", "unnamedDestination",
  "theJeepney", "pinNear", "destinationAt", "youreAt", "walkTo", "waitFor", "changeAt", "changeTo", "startAt", "gotOffAt", "closeTo",
  "almostAt", "gpsUnder10", "gpsMeters", "straightLine", "liveAbout", "liveUnder10", "stopsCount", "toGo", "rideTo", "getOff",
  "alongPathTo", "passedOf", "countAfter", "byStopCount", "reportDriver", "walkSummary", "alongThePath", "alongStreets", "saved",
  "saveTrip", "worksOffline", "saveUnavailable", "streetTitle", "streetTime", "useLocation", "findingLocation", "locationOff",
  "locationOffTap", "noLocation", "noLocationTap", "undoLabel", "transferSteps", "checkDone", "gpsAccuracy", "endConfirmTitle",
  "endConfirmBody", "keepGoing", "replan", "thenRide", "recenter", "steps",
].map((key) => `guidance.${key}`);

/** Keys of the other P1 areas still English in `fil` until the T9 draft + Jev check (area -> leaf keys). */
const PENDING_P1: Record<string, string[]> = {
  geo: [
    "compass.N", "compass.NE", "compass.E", "compass.SE", "compass.S", "compass.SW", "compass.W", "compass.NW", "distanceM",
    "distanceKm", "accuracy",
  ],
  eta: [
    "timeNotAvailable", "min", "hours", "hoursMin", "rangeMin", "rangeLong", "spokenHours", "spokenMinutes", "spokenBoth",
    "spokenRangeMin", "spokenRangeLong", "modeName.jeepney", "modeName.tricycle", "modeName.padyak", "modeName.uv_express",
    "modeName.bus", "modeName.rail", "modesJoin", "notEstimated", "waitingOne", "waitingMany", "noWalking", "estimatePrefix",
    "walkSuffix", "partialSep", "peakNote", "legWalk", "legRide", "remainingRiding", "remainingTrip", "estAbbr", "estimate",
    "waitingRow", "trafficRow", "assumption", "speedAssumption", "speedMixed", "rowWalk", "rowOffpeak", "rowPeak", "rowWindows",
    "everyDay", "everyDayNoData", "serviceHint", "serviceOutside", "serviceEarly", "serviceLastTrips", "serviceOutsideCard",
    "basisTitle", "basisClose", "close", "walkNote", "noModel",
  ],
  trip: [
    "unverifiedBadge", "unverifiedChip", "unverified", "yourLocation", "pinnedLocation", "direction.clockwise",
    "direction.counterclockwise", "fromPinOrder", "fareNoRide", "fareMinimum", "farePerPassenger", "fareEstimate", "fareUnavailable",
    "fareNone", "fareNA", "legFareTraditional", "legFareModern", "legFareMixed", "legFareMixedReports", "legFareDefault",
    "distanceAlongPath", "distanceStraightLine", "fleetMixed", "fleetMixedAircon", "kind.tricycle", "kind.padyak",
    "kindTitle.tricycle", "kindTitle.padyak", "streetKm", "streetAlong", "streetStraight", "streetNoRoute", "streetFareNone",
    "streetFareTricycle", "streetFareTricycleMid", "streetFarePadyak", "streetRide", "freeAlight", "noTransfers", "oneTransfer",
    "transfers", "walkTitle", "tricycleThenJeep", "unnamedPin", "unnamedStop", "samePlaceTitle", "samePlaceHint", "samePlaceDetail",
    "onlyLoops", "outsideCity", "noStopOrigin", "noStopDestination", "noRoute", "walkDetail", "walkShorterTitle",
    "walkShorterDetail", "noRouteNearby", "optionCount", "optionsFound", "unverifiedSentence", "routeShown",
    "jeepneyReason.no_path_near_origin", "jeepneyReason.no_path_near_destination", "jeepneyReason.walk_shorter",
    "jeepneyReason.no_route", "jeepneyReason.roundabout", "jeepneyReason.centro", "timeNotEstimated", "fareNotFixed", "accessLine",
    "fareFrom", "tricycleMin", "tricycleFareNA", "via", "terminalLine", "terminalEndStart", "terminalEndDestination", "toda",
    "terminalCard", "localReport", "farNoteSpecial", "routeNotConfirmed", "streetUnavailable", "alongStreets", "straightApprox",
    "evidence.official", "evidence.news", "evidence.community", "evidence.owner_report_unverified", "pathsNotVerified",
    "tripOptions", "updating", "walkSr", "rideSr", "thenSr", "recommended", "allOptions", "allOptionsOpen", "allOptionsClose",
    "finding", "offline", "offlineDetail", "serverError", "serverDetail", "invalid", "invalidDetail", "busy", "busyDetail",
    "changeEnds", "tryAgain", "candidate", "walkToDestination", "walkToPlace", "theStop", "startAt", "youreThere", "arrive",
    "theJeepney", "transferPoint", "board", "boardDir", "getOnNear", "stopNotMarked", "directionLine", "roadsideAdvice",
    "vehicleUnconfirmed", "rideAlongPath", "stops", "markedStops", "getOffAt", "getOffNear", "paraFree", "sayPara", "takeA",
    "nearestTerminal", "showOnMap", "showOnMapFor", "walkNote", "pathNotVerified", "timeNote", "shared", "copied", "shareFailed",
    "savedRemove", "saved", "updateSaved", "save", "share", "savedCopy", "revision", "saveUnavailable", "startTrip", "backToOptions",
    "sources", "sourcesLabel", "loadingPaths", "pathsUpdated", "straightOffer", "downloading", "downloadFailed", "tripSteps",
    "fareEstimateTitle", "walkingOnly", "confirmDriver", "total", "spansBoth", "noDiscounts", "howFares", "includeExact",
    "yourStart", "yourDestination", "roadside.chipWestCentro", "roadside.chipEastDiversion", "roadside.chipEastOutbound",
    "roadside.chipNorthMagsaysay", "roadside.chipSouthCentro", "roadside.chipOutboundDelRosario", "roadside.chipNorthOutbound",
    "roadside.chipEastDelRosario", "roadside.chipCentroGenLuna", "roadside.chipGenLunaElias", "roadside.chipCentroTerminal",
    "roadside.chipCounterclockwise", "roadside.chipClockwise", "roadside.magsaysayWest", "roadside.magsaysayEast",
    "roadside.magsaysayCentro", "roadside.magsaysayOutbound", "roadside.roxasNorth", "roadside.roxasSouth", "roadside.roxasR3",
    "roadside.roxasR3West", "roadside.roxasR3East", "roadside.francia", "roadside.franciaNorth", "roadside.franciaSouth",
    "roadside.franciaInbound", "roadside.franciaOutbound", "roadside.bagumbayanNorth", "roadside.bagumbayanSouth",
    "roadside.panganiban", "roadside.panganibanInbound", "roadside.panganibanOutbound", "roadside.centroNorth",
    "roadside.centroWest", "roadside.centroTerminal", "roadside.checkCounterclockwise", "roadside.checkClockwise",
  ],
  home: [
    "start", "destination", "chooseStart", "whereTo", "clearStart", "clearDestination", "swap", "tripPlanner", "actions",
    "useCurrentLocation", "chooseOnMap", "searchPlaces", "chooseStartOnMap", "chooseDestinationOnMap", "nearbyStops", "stopsError",
    "stopsNone", "stopsLoading", "mappedCandidate", "mappedCandidateRoutes", "pinLater", "locationOff", "locationOffDetail",
    "noLocation", "unsupported", "insecure", "finding", "outsideNaga", "tooRoughAt", "tooRough", "pinStartOnMap", "approximate",
    "moveStartPin", "youAreHere", "fixJustNow", "fixSeconds", "fixMinutes", "gpsFix", "locationPill", "samePlace", "outsideChoose",
    "savedGone", "changedSinceSaved", "lookingForRoutes", "movePin", "pinCancelled", "cleared", "allCleared", "swapped", "endSet",
    "savedTrip", "routesShown", "routesHidden", "stopsShown", "stopsHidden", "moveToStart", "moveToDestination", "pinOutside",
    "pinMarks", "setStartHere", "setDestinationHere", "cancel", "clearTrip", "theStartPin", "theStop", "guidanceStarted",
    "guidanceEnded", "replanning", "pickWhereYouAre", "reopenFailed", "reopenChecking", "updated", "reopenOffline", "setStart",
    "setDestination", "searchLabel", "browsePlaces", "mappedNotVerified", "zoomIn",
  ],
  shell: [
    "mainNav", "tabs.map", "tabs.explore", "tabs.saved", "tabs.community", "tabs.more", "sheetHalf", "sheetFull", "sheetCollapse",
    "back",
  ],
  kit: [
    "cancel", "badges.verified", "badges.candidate", "badges.documented", "badges.trial", "badges.not-surveyed", "badges.historical",
    "badges.provisional-stops", "badges.osm", "badges.approximate-path", "osmAttribution",
  ],
};
const PENDING_P1_KEYS = Object.entries(PENDING_P1).flatMap(([area, keys]) => keys.map((key) => `${area}.${key}`));

/** Filipino strings allowed to equal the English, with the reason. */
const SAME_AS_EN: Record<string, string> = {
  "app.name": "brand",
  "acknowledgments.community": "pending verbatim-reviewed translation (T13)",
  "acknowledgments.driverReport": "pending verbatim-reviewed translation (T13)",
  ...Object.fromEntries([...PENDING_T9, ...PENDING_P1_KEYS].map((key) => [key, "pending T9 draft"])),
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
