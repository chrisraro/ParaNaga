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

/** The address as is when it is an http(s) URL; anything else is not linked. */
export function externalHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}
