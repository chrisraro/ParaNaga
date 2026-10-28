// Search over one published search index, in the browser (decision D1): nothing is sent to a
// server and no query is logged or stored. Pure: no I/O, no React.
//
// Scoring (task brief): exact name 100 > name prefix 80 > every query word a word prefix 60 >
// substring 40 > fuzzy 20 (character-bigram Dice >= 0.6, 4+ characters, same first letter). A query with
// a digit is also compared without separators, so "R8A", "r8a" and "8a" find R8-A. A route found
// only through a street of its legal plan scores as a substring (40) and says so.
//
// Order: groups in a fixed order (GROUP_ORDER: Saved, Places, Routes, Terminals, Barangays,
// Study labels, Old route names, Regional), so unmapped 1993 names never lead. Regional holds the
// Leaving Naga destinations (IC1) too, with the regional option only. Inside a group:
// score, then where the match starts in the text (a match at the start of a name beats one deep
// inside a long name), then kind order (OpenStreetMap before mapped pins), then index order.
//
// Honesty: only OpenStreetMap places, mapped-pin places and saved places have a location
// (endpointForResult); everything else opens its own screen or notice and is never a trip end.
import type { SavedPlaceSource } from "../saved/saved";
import type { SearchIndex } from "../api/schemas";
import type { LatLng } from "../geo/types";
import type { OsmPlaceCategory } from "../places/osm-categories";
import { isActiveRoute, routeLabel, routeSearchNames } from "../planner/route-display";
import { OSM_CATEGORY_LABEL } from "../places/osm-categories";
import { en, type Dict } from "@/i18n/dict";
import { pinPlaceEndpointLabel, pinPlacePoint } from "../places/place-detail";
import { compactText, foldText, isCodeLikeQuery, tokenize } from "./normalize";

export const GROUP_LIMIT = 5;
/** Task 14: a large Places group reveals this many more rows per tap ("Show 25 more"). */
export const PLACES_STEP = 25;
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

/** A place saved on this phone (Task 8 stores them; search reads label, point and origin). */
export type SavedPlaceInput = { id: string; label: string; point: LatLng; source?: SavedPlaceSource };

/** A Leaving Naga destination (IC1, intercity guide): named only, never a trip end. */
export type IntercityDestinationInput = { code: string; name: string; aliases: readonly string[] };

export type SearchOptions = {
  /** "Include regional connections": destination categories, feeder leads and, when given, the Leaving Naga destinations. */
  regional: boolean;
  saved?: readonly SavedPlaceInput[];
  /** The published intercity guide's destinations (searched only with `regional` on). */
  intercity?: readonly IntercityDestinationInput[];
};

type Ranked = { score: number; offset: number };

export type SearchResult = Ranked &
  (
    | { kind: "saved"; id: string; title: string; point: LatLng; source: SavedPlaceSource }
    | { kind: "osm"; key: string; title: string; category: OsmPlaceCategory; point: LatLng }
    | { kind: "pin"; key: string; title: string; loops: string[]; point: LatLng }
    | {
        kind: "route";
        code: string;
        title: string;
        evidence: "documented" | "provisional" | "verified";
        /** The legal-plan street that matched when the code and name did not; null otherwise. */
        matchedStreet: string | null;
        /** The route alias (stop-sign letter or name) that matched when the code and name did not. */
        matchedAlias?: string | null;
      }
    | { kind: "terminal"; code: string; title: string; locationText: string | null }
    | { kind: "barangay"; key: string; title: string }
    | { kind: "study"; code: string; title: string; routeCode: string | null; direction: string | null }
    | { kind: "legacy"; title: string; sourceCode: string; year: number }
    | { kind: "intercity"; code: string; title: string }
    | { kind: "regional"; title: string; category: string; terminalCode: string | null; terminalName: string | null }
    | { kind: "feeder"; code: string; title: string }
  );

export type SearchResultKind = SearchResult["kind"];

export type SearchGroupId = "saved" | "places" | "routes" | "terminals" | "barangays" | "study" | "legacy" | "regional";

export type SearchGroup = { id: SearchGroupId; title: string; results: SearchResult[] };

const KIND_ORDER: readonly SearchResultKind[] = [
  "saved", "osm", "pin", "route", "terminal", "barangay", "study", "legacy", "intercity", "regional", "feeder",
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
  intercity: "regional",
  regional: "regional",
  feeder: "regional",
};
/** Display order of the groups (brief and artboard): fixed, whatever the scores. */
export const GROUP_ORDER: readonly SearchGroupId[] = ["saved", "places", "routes", "terminals", "barangays", "study", "legacy", "regional"];

export const GROUP_TITLE: Record<SearchGroupId, string> = en.search.group;

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

/** Folded text, words and compact form of one indexed string, computed once per index. */
type Prepared = { folded: string; words: string[]; compact: string };
/** The folded forms of one index's strings (passed down explicitly: no module-level state). */
type FoldCache = Map<string, Prepared>;
const PREPARED = new WeakMap<object, FoldCache>();

function prepare(cache: FoldCache, text: string): Prepared {
  let p = cache.get(text);
  if (!p) {
    p = { folded: foldText(text), words: tokenize(text), compact: compactText(text) };
    cache.set(text, p);
  }
  return p;
}

function textScore(query: Query, text: string, cache: FoldCache, fuzzy = true): Ranked {
  const { folded, words, compact } = prepare(cache, text);
  if (folded === "") return NONE;
  let best = NONE;
  if (folded === query.folded) return { score: EXACT, offset: 0 };
  if (folded.startsWith(query.folded)) return { score: PREFIX, offset: 0 };
  if (query.tokens.length > 0 && query.tokens.every((q) => words.some((w) => w.startsWith(q)))) {
    const firstWord = words.find((w) => w.startsWith(query.tokens[0]!))!;
    best = { score: WORD_PREFIX, offset: Math.max(0, folded.indexOf(firstWord)) };
  } else if (folded.includes(query.folded)) {
    best = { score: SUBSTRING, offset: folded.indexOf(query.folded) };
  }
  if (query.codeLike) {
    if (compact === query.compact) best = better(best, { score: EXACT, offset: 0 });
    else if (compact.startsWith(query.compact)) best = better(best, { score: PREFIX, offset: 0 });
    else if (compact.includes(query.compact)) best = better(best, { score: SUBSTRING, offset: compact.indexOf(query.compact) });
  }
  if (best.score === 0 && fuzzy && fuzzyMatches(query, words, folded)) best = { score: FUZZY, offset: FAR - 1 };
  return best;
}

function bestOf(query: Query, texts: readonly string[], cache: FoldCache, fuzzy = true): Ranked {
  return texts.reduce<Ranked>((acc, t) => better(acc, textScore(query, t, cache, fuzzy)), NONE);
}

// ------------------------------------------------------------------ copy helpers

/** "Loop Service A" → "Loop A"; any other layer verbatim. */
export function loopName(layer: string, copy: Dict["search"] = en.search): string {
  const m = /^Loop Service ([A-Z])$/.exec(layer.trim());
  return m ? copy.loop(m[1]!) : layer;
}

/** "south_suburbs" → "South suburbs"; unknown categories are spelled out the same way. */
export function regionalCategoryLabel(category: string, copy: Dict["search"] = en.search): string {
  const known = Object.hasOwn(copy.regionalCategory, category) ? copy.regionalCategory[category as keyof typeof copy.regionalCategory] : null;
  if (known) return known;
  const words = category.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The second line of a result row (exact copy from the task brief). */
export function resultSubtitle(result: SearchResult, copy: Pick<Dict, "search" | "places"> = en): string {
  const s = copy.search;
  switch (result.kind) {
    case "saved":
      return s.subSaved;
    case "osm":
      return s.subOsm(copy.places.category[result.category]);
    case "pin":
      return s.subPin(result.loops.join(", "));
    case "route":
      if (result.matchedAlias) return s.subAlsoCalled(result.matchedAlias);
      return result.matchedStreet ? s.subLegalStreet(result.matchedStreet) : "";
    case "terminal":
      return s.subTerminal(result.locationText ?? "");
    case "barangay":
      return s.subBarangay;
    case "study": {
      const where = [result.routeCode, result.direction].filter((x): x is string => !!x).join(" ");
      return s.subStudy(where);
    }
    case "legacy":
      return s.subLegacy(result.year, result.sourceCode);
    case "intercity":
      return s.subIntercity;
    case "regional":
      return s.subRegional(regionalCategoryLabel(result.category, s), result.terminalName ?? "");
    case "feeder":
      return s.subFeeder;
  }
}

// ------------------------------------------------------------------ search

function evidenceOf(level: SearchIndex["routes"][number]["evidenceLevel"]): "documented" | "provisional" | "verified" {
  if (level === "provisional") return "provisional";
  if (level === "verified") return "verified";
  return "documented";
}


/** Categories that say little about what a named place is (a named building, an unclassified amenity). */
const GENERIC_CATEGORIES: ReadonlySet<OsmPlaceCategory> = new Set(["building", "other_place"]);

/**
 * On the same score and match offset a real business or landmark (an OpenStreetMap place with a
 * real category) comes before a generic building or unclassified amenity.
 */
function tier(r: SearchResult): number {
  return r.kind === "osm" && !GENERIC_CATEGORIES.has(r.category) ? 0 : 1;
}

function compareResults(a: SearchResult & { i: number }, b: SearchResult & { i: number }): number {
  return (
    b.score - a.score ||
    a.offset - b.offset ||
    tier(a) - tier(b) ||
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
    a.i - b.i
  );
}

/** Every match, grouped; groups and results in display order. Blank query → []. */
export function searchIndex(index: SearchIndex, rawQuery: string, options: SearchOptions): SearchGroup[] {
  const folded = foldText(rawQuery);
  if (folded === "") return [];
  const query: Query = { folded, tokens: tokenize(rawQuery), codeLike: isCodeLikeQuery(rawQuery), compact: compactText(rawQuery) };
  // Folding (NFC/NFD, case, accents) of the index's strings happens once per index object.
  let cache = PREPARED.get(index);
  if (!cache) {
    cache = new Map();
    PREPARED.set(index, cache);
  }
  const fold = cache;
  const best = (texts: readonly string[]) => bestOf(query, texts, fold);
  const hits = (text: string) => textScore(query, text, fold, false).score > 0;
  const out: (SearchResult & { i: number })[] = [];
  const add = (r: SearchResult) => {
    if (r.score > 0) out.push({ ...r, i: out.length });
  };

  for (const s of options.saved ?? []) {
    add({ kind: "saved", id: s.id, title: s.label, point: { ...s.point }, source: s.source ?? "pinned", ...best([s.label]) });
  }
  for (const p of index.osmPlaces) {
    // The category word ("cafe", "pharmacy") finds a place whose name lacks it, below any name match.
    const byName = best([p.name, ...p.aliases]);
    const byCategory = textScore(query, OSM_CATEGORY_LABEL[p.category], fold, false).score > 0 ? { score: SECONDARY, offset: FAR - 2 } : NONE;
    add({ kind: "osm", key: p.key, title: p.name, category: p.category, point: { lat: p.lat, lng: p.lng }, ...better(byName, byCategory) });
  }
  for (const p of index.pinPlaces) {
    const loops = [...new Set(p.pins.flatMap((x) => (x.layer ? [loopName(x.layer)] : [])))].sort();
    add({ kind: "pin", key: p.key, title: p.label, loops, point: pinPlacePoint(p), ...best([p.label, ...p.spellings]) });
  }
  for (const r of index.routes.filter((x) => isActiveRoute(x.code))) {
    // The row reads like the Routes list: letter + title (the published name still finds it).
    const title = routeLabel(r.code, r.name);
    const named = best([r.code, r.name, title, `${r.code} ${r.name}`]);
    // A stop-sign letter ("E") or sign name finds its route as strongly as the code; "Route E", "Route 4", "Loop C" too.
    const aliasHit = [...r.aliases, ...routeSearchNames(r.code)].map((a) => ({ a, m: best([a, `Route ${a}`]) })).sort((x, y) => y.m.score - x.m.score)[0];
    const byAlias = aliasHit !== undefined && aliasHit.m.score > named.score;
    const own = byAlias ? aliasHit.m : named;
    const street = r.streets.find((s) => hits(s)) ?? null;
    const viaStreet = street !== null && own.score < SECONDARY;
    const rank = viaStreet ? { score: SECONDARY, offset: FAR - 2 } : own;
    add({
      kind: "route", code: r.code, title, evidence: evidenceOf(r.evidenceLevel), matchedStreet: viaStreet ? street : null,
      matchedAlias: byAlias && !viaStreet ? aliasHit.a : null, ...rank,
    });
  }
  for (const t of index.terminals) {
    const own = best([t.name]);
    const where = t.locationText && hits(t.locationText) ? { score: SECONDARY, offset: FAR - 2 } : NONE;
    add({ kind: "terminal", code: t.code, title: t.name, locationText: t.locationText, ...better(own, where) });
  }
  for (const b of index.barangays) add({ kind: "barangay", key: b.key, title: b.name, ...best([b.name]) });
  for (const s of index.studyLabels) {
    add({ kind: "study", code: s.code, title: s.label, routeCode: s.routeCode, direction: s.direction, ...best([s.label]) });
  }
  for (const n of index.legacyNames) add({ kind: "legacy", title: n.name, sourceCode: n.sourceCode, year: n.year, ...best([n.name]) });
  if (options.regional) {
    const terminalName = (code: string | null) => index.terminals.find((t) => t.code === code)?.name ?? null;
    for (const c of index.destinationCategories) {
      for (const d of c.destinations) {
        add({ kind: "regional", title: d, category: c.category, terminalCode: c.terminalCode, terminalName: terminalName(c.terminalCode), ...best([d]) });
      }
    }
    for (const f of index.feederLeads) add({ kind: "feeder", code: f.code, title: f.name, ...best([f.name]) });
    // Leaving Naga (IC1): a town or hub outside the city, by its name or an alias; opens S24.
    for (const d of options.intercity ?? []) add({ kind: "intercity", code: d.code, title: d.name, ...best([d.name, ...d.aliases]) });
  }

  out.sort(compareResults);
  const groups = new Map<SearchGroupId, SearchResult[]>();
  for (const id of GROUP_ORDER) groups.set(id, []);
  for (const ranked of out) {
    const { i, ...r } = ranked;
    void i; // only used for the stable sort above
    const id = GROUP_OF[r.kind];
    const list = groups.get(id) ?? [];
    list.push(r as SearchResult);
    groups.set(id, list);
  }
  // Fixed group order (brief, artboard): current data first, old route names (hints only) last.
  return [...groups].filter(([, results]) => results.length > 0).map(([id, results]) => ({ id, title: GROUP_TITLE[id], results }));
}

export type GroupView = {
  /** The rows to show now. */
  rows: SearchResult[];
  /** Button text, or null when nothing is hidden. */
  label: string | null;
  /** The row count after one tap of the button. */
  next: number;
};

/**
 * What a group shows when `shown` rows are revealed (GROUP_LIMIT at first). A button reveals
 * everything ("Show all N"), except a large Places group (Naga has thousands of named places),
 * which reveals PLACES_STEP more at a time until the rest fits in one step.
 */
export function groupView(group: SearchGroup, shown: number = GROUP_LIMIT, copy: Dict["search"] = en.search): GroupView {
  const total = group.results.length;
  const rows = group.results.slice(0, shown);
  const hidden = total - rows.length;
  if (hidden <= 0) return { rows, label: null, next: total };
  if (group.id === "places" && hidden > PLACES_STEP) return { rows, label: copy.showMore(PLACES_STEP), next: rows.length + PLACES_STEP };
  return { rows, label: copy.showAll(total), next: total };
}

export function countResults(groups: readonly SearchGroup[]): number {
  return groups.reduce((n, g) => n + g.results.length, 0);
}

/**
 * Where a result can be a trip start or destination: OpenStreetMap places at their coordinate,
 * mapped-pin places at their first on-route pin (labelled as a mapped pin), saved places at their
 * stored point. Everything else has no location on file: null.
 */
export function endpointForResult(result: SearchResult): { point: LatLng; label: string; place: SavedPlaceSource } | null {
  switch (result.kind) {
    case "osm":
      return { point: { ...result.point }, label: result.title, place: "osm" };
    case "saved":
      return { point: { ...result.point }, label: result.title, place: result.source };
    case "pin":
      return { point: { ...result.point }, label: pinPlaceEndpointLabel(result.title), place: "pin" };
    default:
      return null;
  }
}
