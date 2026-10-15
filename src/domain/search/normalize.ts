// Text normalisation and matching for search. Pure and dependency-free: the server-side index
// builder uses foldText to group mapped-pin labels; the client (Search, Task 5) uses the same
// helpers to match queries against the index, so both sides agree on what "the same text" is.

const MARKS = /\p{M}+/gu;
const SPACES = /\s+/gu;
const NON_WORD = /[^\p{L}\p{N}]+/u;
const NON_WORD_ALL = /[^\p{L}\p{N}]+/gu;
const DIGIT = /\p{N}/u;

/**
 * NFC, trim, collapse whitespace, case-fold and strip diacritics ("  Peñafrancia  Ave" →
 * "penafrancia ave"). Punctuation is kept, so "Penafrancia - Magsaysay" stays distinct from
 * "Penafrancia Magsaysay" when grouping labels.
 */
export function foldText(text: string): string {
  return text
    .normalize("NFC")
    .normalize("NFD")
    .replace(MARKS, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(SPACES, " ")
    .trim();
}

/** Folded words: letters and digits only ("R8-A" → ["r8", "a"]). */
export function tokenize(text: string): string[] {
  return foldText(text).split(NON_WORD).filter((t) => t.length > 0);
}

/** Folded letters and digits only, no separators ("R8-A" → "r8a"): route codes typed loosely. */
export function compactText(text: string): string {
  return foldText(text).replace(NON_WORD_ALL, "");
}

/**
 * True when compact comparison applies: the query has a digit (a route code such as "r8a" or
 * "8a"). Word queries never squeeze words together ("zab" must not match "Plaza Bennett").
 */
export function isCodeLikeQuery(query: string): boolean {
  return DIGIT.test(query) && compactText(query) !== "";
}

export type MatchField = { text: string; weight: number };

const EXACT = 1;
const PREFIX = 0.8;
const WORD_PREFIXES = 0.6;
const SUBSTRING = 0.4;
const COMPACT_PREFIX = 0.7;

function compactScore(query: string, text: string): number {
  if (!isCodeLikeQuery(query)) return 0;
  const cq = compactText(query);
  const ct = compactText(text);
  if (ct.startsWith(cq)) return COMPACT_PREFIX;
  return ct.includes(cq) ? SUBSTRING : 0;
}

function tierScore(query: string, queryTokens: string[], folded: string, text: string): number {
  if (folded === query) return EXACT;
  if (folded.startsWith(query)) return PREFIX;
  const words = tokenize(text);
  if (queryTokens.length > 0 && queryTokens.every((q) => words.some((w) => w.startsWith(q)))) return WORD_PREFIXES;
  return folded.includes(query) ? SUBSTRING : 0;
}

function fieldScore(query: string, queryTokens: string[], text: string): number {
  const folded = foldText(text);
  if (folded === "") return 0;
  return Math.max(tierScore(query, queryTokens, folded, text), compactScore(query, text));
}

/**
 * How well `query` matches the best of `fields` (0 = no match): exact text 1, text prefix 0.8,
 * every query word a prefix of some word 0.6, substring 0.4; for a query with a digit, the
 * compact forms ("r8a" vs "R8-A") also count: prefix 0.7, substring 0.4. Times the field's weight.
 */
export function matchScore(query: string, fields: readonly MatchField[]): number {
  const q = foldText(query);
  if (q === "") return 0;
  const qTokens = tokenize(query);
  let best = 0;
  for (const f of fields) best = Math.max(best, fieldScore(q, qTokens, f.text) * f.weight);
  return best;
}

/** Items matching `query`, best score first; equal scores keep input order. Blank query → []. */
export function rankByQuery<T>(
  query: string,
  items: readonly T[],
  fieldsOf: (item: T) => readonly MatchField[],
  limit = Number.POSITIVE_INFINITY,
): T[] {
  if (foldText(query) === "") return [];
  return items
    .map((item, index) => ({ item, index, score: matchScore(query, fieldsOf(item)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.item);
}
