// Dictionary type and loading (ADR 011). `en` is bundled; `fil` / `bcl` are separate chunks loaded
// on demand. A missing Bikol key falls back to Filipino, then English (owner decision 2026-10-22);
// Filipino is complete by type, so it never needs to.
import { en } from "./en";
import type { Locale } from "./locales";

type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => string
    ? (...args: A) => string
    : { readonly [K in keyof T]: Widen<T[K]> };

/** Every locale's shape: English with its literals widened (message functions keep their parameters). */
export type Dict = Widen<typeof en>;

export type DeepPartial<T> = T extends string | ((...args: never[]) => string) ? T : { readonly [K in keyof T]?: DeepPartial<T[K]> };

/** `over` laid on `base`, key by key. */
export function mergeDict<T>(base: T, over: DeepPartial<T> | undefined): T {
  if (over === undefined) return base;
  if (typeof base !== "object" || base === null) return over as T;
  const out = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(over)) out[key] = mergeDict(out[key], value);
  return out as T;
}

export async function loadDict(locale: Locale): Promise<Dict> {
  if (locale === "en") return en;
  const { fil } = await import("./fil");
  if (locale === "fil") return fil;
  const { bcl } = await import("./bcl");
  return mergeDict<Dict>(fil, bcl);
}

export { en };
