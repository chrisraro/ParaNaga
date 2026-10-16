// Street-name matching between the LPTRP legal street lists and OpenStreetMap way names.
// Normalization is for MATCHING only: displayed names stay verbatim.
//
//   NFC → strip diacritics (Peñafrancia ≡ Penafrancia) → case-fold → punctuation to spaces →
//   expand whole-word abbreviations (Ave → avenue, St → street, Dr → drive, Rd → road,
//   Hwy → highway, Gen → general) → collapse spaces.
//
// Pure; no dependencies.

const ABBREVIATIONS: Readonly<Record<string, string>> = {
  ave: "avenue",
  st: "street",
  dr: "drive",
  rd: "road",
  hwy: "highway",
  gen: "general",
};

/** The way tags that may carry a street name, in matching order. */
export const STREET_NAME_TAGS = ["name", "alt_name", "old_name", "official_name"] as const;
export type StreetNameTag = (typeof STREET_NAME_TAGS)[number];

export function normalizeStreetName(raw: string): string {
  const folded = raw
    .normalize("NFC")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (folded === "") return "";
  return folded
    .split(" ")
    .map((w) => ABBREVIATIONS[w] ?? w)
    .join(" ");
}

/** Values of one name tag (OSM separates several values with ";"), normalized, empty ones dropped. */
function tagValues(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(";")
    .map(normalizeStreetName)
    .filter((v) => v !== "");
}

/** Distinct normalized street names of a way (name, alt_name, old_name, official_name), first seen first. */
export function wayStreetNames(tags: Partial<Record<string, string>>): string[] {
  const out: string[] = [];
  for (const k of STREET_NAME_TAGS) for (const v of tagValues(tags[k])) if (!out.includes(v)) out.push(v);
  return out;
}

/** A reviewed alias: the legal street name and the OSM name it means (modes seed `streetAliases`). */
export type StreetAlias = { legalName: string; osmName: string };

/**
 * Which tag of `way` matches the legal street name: "name", "alt_name", "old_name",
 * "official_name", or "alias" (a reviewed alias whose OSM name is one of the way's names);
 * null when none does.
 */
export function matchStreet(
  legalName: string,
  way: { tags: Partial<Record<string, string>> },
  aliases: readonly StreetAlias[],
): StreetNameTag | "alias" | null {
  const legal = normalizeStreetName(legalName);
  if (legal === "") return null;
  for (const k of STREET_NAME_TAGS) if (tagValues(way.tags[k]).includes(legal)) return k;
  const names = wayStreetNames(way.tags);
  const viaAlias = aliases.some((a) => normalizeStreetName(a.legalName) === legal && names.includes(normalizeStreetName(a.osmName)));
  return viaAlias ? "alias" : null;
}
