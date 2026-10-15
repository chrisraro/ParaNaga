// Lines of the sources register (spec S22, Help → Sources and dates). Source values are shown
// verbatim apart from the evidence type, which is stored as a snake_case tag and read out as words;
// a missing value says it is not recorded. Pure.
import type { SourceList } from "../api/schemas";
import { formatIsoDate } from "../network/present";

type Source = SourceList["sources"][number];

export function sourceTitleLine(source: Pick<Source, "code" | "title">): string {
  return `${source.code} · ${source.title}`;
}

/** "official_historical" → "Official historical"; "a;b" → "A, b". Acronyms keep their case. */
function evidenceText(tag: string | null): string {
  const words = tag?.trim().replace(/_/g, " ").replace(/\s*;\s*/g, ", ") ?? "";
  if (!words) return "Evidence type not recorded";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "{evidence type} · published {date or text} · checked {date}". */
export function sourceMetaLine(source: Pick<Source, "evidenceType" | "publishedOrEnacted" | "checkedOn">): string {
  const raw = source.publishedOrEnacted?.trim();
  const published = raw ? `published ${formatIsoDate(raw) ?? raw}` : "publication date not recorded";
  const checkedDate = formatIsoDate(source.checkedOn);
  const checked = checkedDate ? `checked ${checkedDate}` : "check date not recorded";
  return `${evidenceText(source.evidenceType)} · ${published} · ${checked}`;
}

/**
 * External addresses that may keep a query string: only where the query is the fixed identity of
 * the page and no other address exists for it. The My Maps viewer needs `?mid=` (S39) and a Play
 * Store listing needs `?id=` (MyNaga). Everything else with a query is not linked; that includes
 * the My Maps KML export (S40, `?mid=…&forcekml=1`), which downloads a file.
 */
export const QUERY_ALLOW_LIST: readonly { host: string; path: string; params: readonly string[] }[] = [
  { host: "www.google.com", path: "/maps/d/viewer", params: ["mid"] },
  { host: "play.google.com", path: "/store/apps/details", params: ["id"] },
];

function queryAllowed(url: URL): boolean {
  if (url.search === "") return true;
  const keys = [...url.searchParams.keys()];
  return QUERY_ALLOW_LIST.some(
    (a) => url.hostname === a.host && url.pathname === a.path && keys.length === a.params.length && a.params.every((p) => keys.includes(p)),
  );
}

/**
 * The address as is when it is an http(s) URL with no query string, or one on QUERY_ALLOW_LIST;
 * anything else is not linked. Nothing is ever added to an address.
 */
export function externalHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return queryAllowed(parsed) ? url : null;
  } catch {
    return null;
  }
}
