// Search over one published search index, in the browser (decision D1): nothing is sent to a
// server and no query is logged or stored. Pure: no I/O, no React.
//
// Scoring (task brief): exact name 100 > name prefix 80 > every query word a word prefix 60 >
// substring 40 > fuzzy 20 (character-bigram Dice >= 0.6, 4+ characters, same first letter). A query with
// a digit is also compared without separators, so "R8A", "r8a" and "8a" find R8-A. A route found
// only through a street of its legal plan scores as a substring (40) and says so.
//
// Order: groups by their best result; results by score, then by where the match starts in the
// text (a match at the start of a name beats one deep inside a long name), then by kind order
// (Saved, Places: OpenStreetMap then mapped pins, Routes, Terminals, Barangays, Study labels, Old
// names, Regional), then index order.
//
// Honesty: only OpenStreetMap places, mapped-pin places and saved places have a location
// (endpointForResult); everything else opens its own screen or notice and is never a trip end.
import type { SearchIndex } from "../api/schemas";
import type { LatLng } from "../geo/types";
import type { OsmPlaceCategory } from "../places/osm-categories";
import { OSM_CATEGORY_LABEL } from "../places/osm-categories";
import { compactText, foldText, isCodeLikeQuery, tokenize } from "./normalize";

export const GROUP_LIMIT = 5;
export const FUZZY_MIN_CHARS = 4;
export const FUZZY_MIN_DICE = 0.6;

const EXACT = 100;
const PREFIX = 80;
const WORD_PREFIX = 60;
const SUBSTRING = 40;
const FUZZY = 20;
/** A street of the legal route plan (or a terminal's location text) counts as a substring hit. */
const SECONDARY = SUBSTRING;
const FAR = 1_000_000;

/** A place saved on this phone (Task 8 stores them; search only reads label and point). */
export type SavedPlaceInput = { id: string; label: string; point: LatLng };

export type SearchOptions = {
  /** "Include regional connections": destination categories and feeder leads. */
  regional: boolean;
  saved?: readonly SavedPlaceInput[];
};

type Ranked = { score: number; offset: number };

export type SearchResult = Ranked &
  (
    | { kind: "saved"; id: string; title: string; point: LatLng }
    | { kind: "osm"; key: string; title: string; category: OsmPlaceCategory; point: LatLng }
    | { kind: "pin"; key: string; title: string; loops: string[]; point: LatLng }
    | {
        kind: "route";
        code: string;
        title: string;
        evidence: "documented" | "provisional" | "verified";
        /** The legal-plan street that matched when the code and name did not; null otherwise. */
        matchedStreet: string | null;
      }
    | { kind: "terminal"; code: string; title: string; locationText: string | null }
    | { kind: "barangay"; key: string; title: string }
    | { kind: "study"; code: string; title: string; routeCode: string | null; direction: string | null }
    | { kind: "legacy"; title: string; sourceCode: string; year: number }
    | { kind: "regional"; title: string; category: string; terminalCode: string | null; terminalName: string | null }
    | { kind: "feeder"; code: string; title: string }
  );

export type SearchResultKind = SearchResult["kind"];

export type SearchGroupId = "saved" | "places" | "routes" | "terminals" | "barangays" | "study" | "legacy" | "regional";

export type SearchGroup = { id: SearchGroupId; title: string; results: SearchResult[] };

const KIND_ORDER: readonly SearchResultKind[] = [
  "saved", "osm", "pin", "route", "terminal", "barangay", "study", "legacy", "regional", "feeder",
];
const GROUP_OF: Record<SearchResultKind, SearchGroupId> = {
  saved: "saved",
  osm: "places",
  pin: "places",
  route: "routes",
  terminal: "terminals",
  barangay: "barangays",
  study: "study",
  legacy: "legacy",
  regional: "regional",
  feeder: "regional",
};
export const GROUP_TITLE: Record<SearchGroupId, string> = {
  saved: "Saved",
  places: "Places",
  routes: "Routes",
  terminals: "Terminals",
  barangays: "Barangays",
  study: "Stop labels from the 2025 route study",
  legacy: "Old route names",
  regional: "Regional destinations",
};

// ------------------------------------------------------------------ text scoring

type Query = { folded: string; tokens: string[]; codeLike: boolean; compact: string };

function bigrams(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i += 1) {
    const pair = text.slice(i, i + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

/** Sørensen–Dice coefficient of the character bigrams (multiset) of two strings, 0..1. */
export function bigramDice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b && a.length > 0 ? 1 : 0;
  const x = bigrams(a);
  const y = bigrams(b);
  let common = 0;
  for (const [pair, n] of x) common += Math.min(n, y.get(pair) ?? 0);
  return (2 * common) / (a.length - 1 + (b.length - 1));
}

/**
 * A typo-tolerant match: the query (4+ letters) against the whole text or any run of as many
 * words, with the same first letter (typos rarely hit it, and it keeps "Iriga" off "Brigade").
 */
function fuzzyMatches(query: Query, words: string[], folded: string): boolean {
  const q = query.tokens.join(" ");
  if (q.replace(/ /g, "").length < FUZZY_MIN_CHARS) return false;
  const close = (candidate: string) => candidate[0] === q[0] && bigramDice(q, candidate) >= FUZZY_MIN_DICE;
  if (close(folded)) return true;
  const k = query.tokens.length;
  for (let i = 0; i + k <= words.length; i += 1) {
    if (close(words.slice(i, i + k).join(" "))) return true;
  }
  return false;
}

const NONE: Ranked = { score: 0, offset: FAR };

function better(a: Ranked, b: Ranked): Ranked {
  return b.score > a.score || (b.score === a.score && b.offset < a.offset) ? b : a;
}

function textScore(query: Query, text: string, fuzzy = true): Ranked {
  const folded = foldText(text);
  if (folded === "") return NONE;
  let best = NONE;
  if (folded === query.folded) return { score: EXACT, offset: 0 };
  if (folded.startsWith(query.folded)) return { score: PREFIX, offset: 0 };
  const words = tokenize(text);
  if (query.tokens.length > 0 && query.tokens.every((q) => words.some((w) => w.startsWith(q)))) {
    const firstWord = words.find((w) => w.startsWith(query.tokens[0]!))!;
    best = { score: WORD_PREFIX, offset: Math.max(0, folded.indexOf(firstWord)) };
  } else if (folded.includes(query.folded)) {
    best = { score: SUBSTRING, offset: folded.indexOf(query.folded) };
  }
  if (query.codeLike) {
    const compact = compactText(text);
    if (compact === query.compact) best = better(best, { score: EXACT, offset: 0 });
    else if (compact.startsWith(query.compact)) best = better(best, { score: PREFIX, offset: 0 });
    else if (compact.includes(query.compact)) best = better(best, { score: SUBSTRING, offset: compact.indexOf(query.compact) });
  }
  if (best.score === 0 && fuzzy && fuzzyMatches(query, words, folded)) best = { score: FUZZY, offset: FAR - 1 };
  return best;
}

function bestOf(query: Query, texts: readonly string[], fuzzy = true): Ranked {
  return texts.reduce<Ranked>((acc, t) => better(acc, textScore(query, t, fuzzy)), NONE);
}

// ------------------------------------------------------------------ copy helpers

/** "Loop Service A" → "Loop A"; any other layer verbatim. */
export function loopName(layer: string): string {
  const m = /^Loop Service ([A-Z])$/.exec(layer.trim());
  return m ? `Loop ${m[1]}` : layer;
}

const REGIONAL_CATEGORY: Record<string, string> = {
  northbound: "Northbound",
  south_suburbs: "South suburbs",
  north_suburb: "North suburb",
  southbound: "Southbound",
  eastbound: "Eastbound",
};

/** "south_suburbs" → "South suburbs"; unknown categories are spelled out the same way. */
export function regionalCategoryLabel(category: string): string {
  const known = REGIONAL_CATEGORY[category];
  if (known) return known;
  const words = category.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The second line of a result row (exact copy from the task brief). */
export function resultSubtitle(result: SearchResult): string {
  switch (result.kind) {
    case "saved":
      return "Saved place";
    case "osm":
      return `${OSM_CATEGORY_LABEL[result.category]} · from OpenStreetMap`;
    case "pin":
      return `Mapped stop · ${result.loops.length > 0 ? `${result.loops.join(", ")} · ` : ""}candidate`;
    case "route":
      return result.matchedStreet ? `Legal route plan lists ${result.matchedStreet}` : "";
    case "terminal":
      return `Terminal · ${result.locationText ? `${result.locationText} · ` : ""}location not mapped`;
    case "barangay":
      return "Barangay · not surveyed";
    case "study": {
      const where = [result.routeCode, result.direction].filter((x): x is string => !!x).join(" ");
      return `${where ? `${where} · ` : ""}label only, no location`;
    }
    case "legacy":
      return `Historical name (${result.year}) · not matched to a current route · ${result.sourceCode}`;
    case "regional": {
      const from = result.terminalName ? ` from ${result.terminalName}` : "";
      return `${regionalCategoryLabel(result.category)} destinations${from} · services not verified`;
    }
    case "feeder":
      return "Feeder service lead · not verified";
  }
}

// ------------------------------------------------------------------ search

function evidenceOf(level: SearchIndex["routes"][number]["evidenceLevel"]): "documented" | "provisional" | "verified" {
  if (level === "provisional") return "provisional";
  if (level === "verified") return "verified";
  return "documented";
}

/** The pin a mapped-pin place is used at: its first on-route pin, else its first pin. */
function pinPoint(place: SearchIndex["pinPlaces"][number]): LatLng {
  const pin = place.pins.find((p) => p.onRoute) ?? place.pins[0]!;
  return { lat: pin.lat, lng: pin.lng };
}

function compareResults(a: SearchResult & { i: number }, b: SearchResult & { i: number }): number {
  return (
    b.score - a.score ||
    a.offset - b.offset ||
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
    a.i - b.i
  );
}

/** Every match, grouped; groups and results in display order. Blank query → []. */
export function searchIndex(index: SearchIndex, rawQuery: string, options: SearchOptions): SearchGroup[] {
  const folded = foldText(rawQuery);
  if (folded === "") return [];
  const query: Query = { folded, tokens: tokenize(rawQuery), codeLike: isCodeLikeQuery(rawQuery), compact: compactText(rawQuery) };
  const out: (SearchResult & { i: number })[] = [];
  const add = (r: SearchResult) => {
    if (r.score > 0) out.push({ ...r, i: out.length });
  };

  for (const s of options.saved ?? []) {
    add({ kind: "saved", id: s.id, title: s.label, point: { ...s.point }, ...bestOf(query, [s.label]) });
  }
  for (const p of index.osmPlaces) {
    add({ kind: "osm", key: p.key, title: p.name, category: p.category, point: { lat: p.lat, lng: p.lng }, ...bestOf(query, [p.name, ...p.aliases]) });
  }
  for (const p of index.pinPlaces) {
    const loops = [...new Set(p.pins.flatMap((x) => (x.layer ? [loopName(x.layer)] : [])))].sort();
    add({ kind: "pin", key: p.key, title: p.label, loops, point: pinPoint(p), ...bestOf(query, [p.label, ...p.spellings]) });
  }
  for (const r of index.routes) {
    const title = `${r.code} ${r.name}`;
    const own = bestOf(query, [r.code, r.name, title]);
    const street = r.streets.find((s) => textScore(query, s, false).score > 0) ?? null;
    const viaStreet = street !== null && own.score < SECONDARY;
    const rank = viaStreet ? { score: SECONDARY, offset: FAR - 2 } : own;
    add({ kind: "route", code: r.code, title, evidence: evidenceOf(r.evidenceLevel), matchedStreet: viaStreet ? street : null, ...rank });
  }
  for (const t of index.terminals) {
    const own = bestOf(query, [t.name]);
    const where = t.locationText && textScore(query, t.locationText, false).score > 0 ? { score: SECONDARY, offset: FAR - 2 } : NONE;
    add({ kind: "terminal", code: t.code, title: t.name, locationText: t.locationText, ...better(own, where) });
  }
  for (const b of index.barangays) add({ kind: "barangay", key: b.key, title: b.name, ...bestOf(query, [b.name]) });
  for (const s of index.studyLabels) {
    add({ kind: "study", code: s.code, title: s.label, routeCode: s.routeCode, direction: s.direction, ...bestOf(query, [s.label]) });
  }
  for (const n of index.legacyNames) add({ kind: "legacy", title: n.name, sourceCode: n.sourceCode, year: n.year, ...bestOf(query, [n.name]) });
  if (options.regional) {
    const terminalName = (code: string | null) => index.terminals.find((t) => t.code === code)?.name ?? null;
    for (const c of index.destinationCategories) {
      for (const d of c.destinations) {
        add({ kind: "regional", title: d, category: c.category, terminalCode: c.terminalCode, terminalName: terminalName(c.terminalCode), ...bestOf(query, [d]) });
      }
    }
    for (const f of index.feederLeads) add({ kind: "feeder", code: f.code, title: f.name, ...bestOf(query, [f.name]) });
  }

  out.sort(compareResults);
  const groups = new Map<SearchGroupId, SearchResult[]>();
  for (const ranked of out) {
    const { i, ...r } = ranked;
    void i; // only used for the stable sort above
    const id = GROUP_OF[r.kind];
    const list = groups.get(id) ?? [];
    list.push(r as SearchResult);
    groups.set(id, list);
  }
  // Map insertion order follows the first (best) result of each group.
  return [...groups].map(([id, results]) => ({ id, title: GROUP_TITLE[id], results }));
}

export function countResults(groups: readonly SearchGroup[]): number {
  return groups.reduce((n, g) => n + g.results.length, 0);
}

/**
 * Where a result can be a trip start or destination: OpenStreetMap places at their coordinate,
 * mapped-pin places at their first on-route pin (labelled as a mapped pin), saved places at their
 * stored point. Everything else has no location on file: null.
 */
export function endpointForResult(result: SearchResult): { point: LatLng; label: string } | null {
  switch (result.kind) {
    case "osm":
    case "saved":
      return { point: { ...result.point }, label: result.title };
    case "pin":
      return { point: { ...result.point }, label: `${result.title} (mapped pin)` };
    default:
      return null;
  }
}
