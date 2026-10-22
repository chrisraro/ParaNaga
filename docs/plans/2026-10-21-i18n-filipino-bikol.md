# Sitewide translation: Filipino, then Bikol-Naga (plan)

Status (2026-10-22): in progress (G1 Filipino on is done; T11 running; Bikol hidden until native review).

Date: 2026-10-21 · Status: PLAN ONLY (no app code changed) · Supersedes: Increment A **D8 "English only"**
(docs/plans/2026-10-16-commuter-screens.md) and the `next-intl` / `[locale]` rows in docs/spec/03-architecture.md
(lines 44, 62–64, 91). Spec intent kept: docs/spec/01-product.md §7 "Bilingual from day one … reviewed Bikol (`bcl`)",
02-features.md §Settings "Language (en / fil; bcl when reviewed)", 06-screens.md §6.1 (fil runs ~20 % longer) and §6.5
(copy rules "localized via message catalog").

Read before deciding: `node_modules/next/dist/docs/01-app/02-guides/internationalization.md` (Next 16.4.1). It shows
the `app/[lang]` + `proxy.ts` redirect + `generateStaticParams` + `next/root-params` pattern and plain typed
dictionaries; it names next-intl only as an optional library. Nothing in it forces a URL prefix or a dependency.

---

## 0. Decision summary

| Topic | Decision |
|---|---|
| Library | **In-house typed TS dictionary + React context. No new dependency.** Extend the existing skeleton `src/i18n/messages.ts`. |
| Locales | `en` (default, source of truth) · `fil` · `bcl` (hidden behind `BIKOL_ENABLED` until native sign-off) |
| Locale in URL | **No prefix** for `/app/**` (and for `/` in phase 1). Locale is a device preference. Optional `/fil` landing for SEO later (§1.3). |
| Storage | `paranaga.prefs` localStorage key (`locale` field), same as theme. No cookie, no server, no tracking. |
| `<html lang>` | Server renders `en`; `public/theme-init.js` sets `lang` from prefs before first paint. |
| Missing key | `fil` must be complete (typecheck fails otherwise). `bcl` may be partial while drafting; runtime falls back to `en` per key; enabling `bcl` requires 100 % native-approved (test). |
| Domain copy | Pure functions take a `copy` argument that **defaults to English**, so the 185 existing unit test files keep passing unchanged. |
| Formatting | `Intl` with an explicit map: `en→en-PH`, `fil→fil-PH`, `bcl→fil-PH` (no CLDR data for `bcl`, see §1.6). |

---

## 1. Architecture

### 1.1 Locale codes (verified)

- **`fil`**: ISO 639-2/3 code for Filipino. Use `fil`, not `tl` (Tagalog). Node 26 ICU ships CLDR data for `fil`
  (`Intl.DateTimeFormat.supportedLocalesOf(["fil"])` → `["fil"]`; `tl` canonicalises to `fil`).
- **`bcl`**: ISO 639-3 individual language **Central Bikol**. `bik` is the ISO 639-2 *macrolanguage* "Bikol" that also
  covers Rinconada, Buhi'non, Libon, Miraya, Albay and Catanduanes varieties, so `bik` is too broad. IANA subtag
  registry: `bcl`, "Central Bikol", Macrolanguage `bik` (renamed from "Central Bicolano" 2012).
  Sources: [IANA bcl template](https://www.iana.org/assignments/lang-subtags-templates/bcl.txt),
  [ISO 639 macrolanguage (Wikipedia)](https://en.wikipedia.org/wiki/ISO_639_macrolanguage),
  [Central Bikol (Wikipedia)](https://en.wikipedia.org/wiki/Central_Bikol).
- Variety note: Wikipedia lists the **Canaman** dialect as the literary/media standard and **Naga City** as a
  separate (mutually intelligible) dialect; Naga uses initial `h` where Legazpi drops it (`hiling` vs `iling`).
  We target **Naga City usage** and record it as `bcl` (no private-use subtag; a `bcl-x-naga` tag buys nothing).
  Node has no CLDR data for `bcl` (`supportedLocalesOf(["bcl"])` → `[]`).

### 1.2 Library: in-house vs next-intl

| | In-house typed dictionary + context | next-intl |
|---|---|---|
| New deps | none | `next-intl` (+ `use-intl`, ICU message parser) |
| Fits no-prefix, static, offline shells | yes, client reads prefs | its strong path is `[locale]` routing + middleware/proxy; no-prefix mode still wants a request-time locale (cookie/header), which conflicts with our static, SW-cached shells and "no request-time APIs" in `/app/layout.tsx` |
| Domain layer (pure TS, e.g. `guidanceView`) | pass a plain object; functions like `boarded(chip)` are native TS | needs `createTranslator` + ICU strings; interpolations become stringly-typed ICU |
| Type-safe keys | `fil: Dict` → missing key = TS error; function signatures checked | key typing via module augmentation; argument names checked, not shapes |
| Plurals | `fil`/`bcl` nouns do not inflect; English needs ~5 count strings → plain functions | ICU plural |
| Effort | ~150 lines of infra | similar wiring plus ICU conversion of ~1,500 strings |

**Pick: in-house.** Every string with a parameter is already a TS function (`GUIDANCE_COPY.paraBody(stop)`), the
domain layer is pure and React-free, and the shells must stay static for the service worker. next-intl would add a
runtime and a message syntax without removing any work. Revisit only if a fourth locale or translator tooling (XLIFF /
Crowdin) appears; dictionaries are plain objects, so exporting them later is mechanical.

### 1.3 Where the locale lives (no URL prefix)

- **Why not `/[lang]/app/...`**: `SHELL_PATHS` in `src/domain/pwa/sw-routes.ts` would triple (one cached shell per
  locale), deep links/QR codes/saved-trip links would carry a language, `/app` would need a proxy redirect on every
  navigation (today `proxy.ts` runs only for auth), and the app pages are not indexed (`robots.ts`) so prefixes buy no SEO.
- **Storage**: add `locale: "en" | "fil" | "bcl"` to `Prefs` in `src/domain/prefs/prefs.ts` (zod `.catch("en")`;
  `bcl` coerced to `en` while `BIKOL_ENABLED` is false). Same key `paranaga.prefs`, so `theme-init.js` reads it
  synchronously.
- **First open default**: `en` unless the owner decides to follow `navigator.languages` (open question 4). No
  geolocation or IP-based guessing.
- **Signed-in users**: `core.profile.locale` exists in the data model; syncing it is **not** in scope (device pref wins).
- **Landing SEO (`/`)**: phase 1 uses the same client switch (Google indexes English). Optional phase 5: a static
  `src/app/fil/page.tsx` (and later `/bcl`) rendering `<LandingPage locale="fil">`, with `alternates.languages`
  (hreflang) in metadata. Costs one route per locale, no proxy. Only if the owner wants Filipino search traffic (open question 5).

### 1.4 Runtime shape

```
src/i18n/
  locales.ts        LOCALES = ["en","fil","bcl"], BIKOL_ENABLED, formatLocale(locale) → "en-PH" | "fil-PH"
  en/index.ts       source of truth, split by area: guidance.ts, trip.ts, home.ts, ... (as const)
  fil/index.ts      `export const fil = {...} satisfies Dict`   (complete: typecheck enforces)
  bcl/index.ts      `export const bcl = {...} satisfies DeepPartial<Dict>`
  dict.ts           type Dict = Widen<typeof en>  (string literals → string, functions keep signatures)
                    resolve(locale) → deep-merge(en, partial) for bcl; identity for en/fil
  provider.tsx      "use client" LocaleProvider + useT() + useLocale(); reads prefs via existing use-prefs store
```

- `fil` and `bcl` are loaded with dynamic `import()` so English users do not download them; the chunks are build
  assets, so Serwist's `__SW_MANIFEST` precaches them (verify in task T4) and the switch works offline.
- `LocaleProvider` sits in `src/app/layout.tsx` beside `PwaRoot`; `getServerSnapshot` returns `en`, so static HTML stays
  English and hydration then re-renders in the stored locale (same model as theme). Accept a one-frame English flash on
  cold load; measure on a mid-range phone before adding any hiding CSS.
- `document.title` / `metadata`: static `metadata` stays English (SEO); `useDocumentTitle` (src/ui/app-shell/document-title.ts) takes translated strings.
- Existing `messages.ts` (`acknowledgments.*`, `app.tagline`) moves into `en/legal.ts` / `fil/legal.ts`; its
  `fil.acknowledgments = en.acknowledgments` placeholder becomes a real reviewed translation (spec §6.5 last bullet).

### 1.5 Language switcher

- **More → Settings**: replace `ListCell title="Language" trailing="English" sub="Filipino planned."`
  (src/ui/settings/more-screen.tsx:160) with the existing `Segmented` kit control: `English · Filipino` (+ `Bikol`
  when enabled). Option labels are written in their own language (`English`, `Filipino`, `Bikol`) and carry `lang`
  attributes for screen readers.
- **Landing header** (src/ui/landing/site-header.tsx): a compact `EN | FIL` text toggle in the pill header and inside
  the mobile section sheet; it writes the same pref, so the app opens in that language.
- **Not** in the guidance screen (no mid-trip language flips).

### 1.6 `html lang`, fallback, Intl

- `theme-init.js` adds: `root.lang = prefs.locale === "fil" ? "fil" : prefs.locale === "bcl" && enabled ? "bcl" : "en"`.
  `<html suppressHydrationWarning>` is already set. Per-key English fallback in `bcl` gets `<span lang="en">` only
  where it is a full sentence (screen readers switch voice); not worth it per word.
- Dates: replace the 7 hard-coded `"en-PH"` / `"en-GB"` / `"en"` sites (network/present.ts, reports/list.ts,
  community/parts.tsx, driver-report-wizard.tsx, search-screen.tsx, places/explore.ts collator) with
  `formatLocale(locale)`. `bcl → fil-PH`: Bikol month names are Spanish-derived like Filipino ("Okt 21, 2026");
  flag for reviewer. Timezone stays `Asia/Manila`.
- Numbers/peso: unchanged (`₱14–₱17`, digits); ranges keep the en dash.
- Plurals: `fil` and `bcl` do not inflect nouns ("1 hintuan / 3 hintuan"); counts are message functions
  `(n: number) => string` per locale. English keeps its ternaries (`stopsCount` in guidance/view.ts).

### 1.7 Type safety and guard tests (tests/unit/i18n-*.test.ts)

1. **Completeness**: `fil satisfies Dict` (tsc). Test walks `en` and asserts every key exists in `fil`.
2. **Not-just-English**: every `fil` leaf differs from `en` unless listed in `SAME_AS_EN` (brand, route codes, "Para",
   "Offline", "₱"). Catches the `fil.acknowledgments = en.acknowledgments` kind of placeholder.
3. **Placeholders**: each function message is called with sentinel args (`"⟦A⟧"`, `987`) in every locale; output
   must contain every sentinel.
4. **§6.5 per locale**: banned patterns per locale (en: live / ETA / arriving / guaranteed / e-jeep; fil: `live`,
   `ETA`, `darating`, `parating`, `garantisado`, `e-jeep`, `e-dyip`, `opisyal` outside allowlisted keys; bcl list
   from the reviewer). Estimate keys must contain the locale's estimate marker (`≈`, `Tantiya…`/glossary term).
   `guidance.paraTitle` must contain "Para" in every locale.
5. **Bikol gate**: if `BIKOL_ENABLED`, every `bcl` key exists and its ledger status is `native_approved`.
6. **Length budget**: `fil`/`bcl` ≤ 1.35 × `en` characters for keys tagged `short` (buttons, chips, tab labels);
   `copy-budget.test.tsx` word budgets run once more under `fil` with a relaxed factor (owner to confirm; §6.1 says ~20 %).
7. **Pseudo-locale** (test-only, `en-XA`, generated from `en`: accents + 30 % padding) rendered in a few screen
   tests to catch hard-coded strings and overflow (spec §6.1 "pseudo-expanded strings"). Not shipped.

---

## 2. Extraction strategy

**Scope count** (rough, string-literal heuristic): `src/ui` 123 files / 20k lines, `src/domain` 123 files / 18k lines.
Not translated: route codes and titles (`ROUTE_DISPLAY`), stop/place/terminal names (proper nouns, from data and
OSM), source register values (`domain/sources` shows source titles verbatim), admin console, API error codes, server
logs, CSP reports. Data-side `title_i18n jsonb` (disruptions) is out of scope until disruptions ship.

**Pattern for domain copy** (keeps tests on English with zero edits):

```ts
// before
export const GUIDANCE_COPY = { endGuidance: "End guidance", boarded: (chip: string) => `I boarded ${chip}`, ... } as const;
export function guidanceView(session, fix, now) { ... GUIDANCE_COPY.endGuidance ... `Step ${i+1} of ${n} · Ride` ... }

// after
import { en, type Dict } from "@/i18n";
export const GUIDANCE_COPY = en.guidance;                 // kept as an alias, tests importing it still work
export function guidanceView(session, fix, now, copy: Dict["guidance"] = en.guidance) { ... }
// UI: const t = useT(); guidanceView(session, fix, now, t.guidance)
```

Inline templates inside domain functions (`Step ${index + 1} of ${total} · ${name}`, `Close to ${targetName}…`,
`gpsMeters`, `stopsCount`) move into the same `guidance` dictionary as functions. Module-level `const END = {label: …}`
becomes a function of `copy`.

**Order** (each phase is one shippable slice; Filipino enabled only after phase 1 is reviewed):

| Phase | Areas | Why first |
|---|---|---|
| P0 | infra, prefs, switcher, guard tests, glossary, ledger | everything depends on it |
| P1 | guidance (domain/guidance/view.ts, announce.ts, steps.ts; ui/guidance/*), trip (domain/trip, domain/eta format, ui/trip/*), home (ui/home/*, home-chips, location-status), app-shell tab bar, kit (confirm dialog, badges), status badges + fare chips (§6.1 list) | the ride itself; safety-relevant (Para, get-off prompts, live announcements) |
| P2 | search, places, stops, routes, terminals, explore, saved, map (legend, layers sheet, line notes), pwa (offline banner/screen, update prompt, install row), settings | rest of the commuter loop |
| P3 | help articles (ui/help/articles.ts, long-form), report + report-driver wizards, reports, community, mynaga handoff, auth, sources screen labels, moderation rejection templates (spec §6.5: from templates, keyed) | low traffic or long-form; acknowledgments need verbatim reviewed text |
| P4 | landing (landing-content.ts, site-header, hero-lines, alt text) | marketing; screenshots stay English unless `capture:landing` gets a locale flag |
| P5 (optional) | `/fil` (and `/bcl`) static landing with hreflang | only if owner wants Filipino SEO |
| B | Bikol drafting for all keys → native review → flip `BIKOL_ENABLED` | after Filipino ships |

Screen-reader-only text, `aria-label`s and `aria-live` announcements (guidance/announce.ts) are extracted in the same
phase as their screen, not later.

---

## 3. Translation sourcing and starter glossary

### 3.1 Sources used (researched 2026-10-21)

- **Mintz, *Bikol Dictionary*** (University of Hawai'i Press 2018, open access CC BY-NC-SA 4.0, Bikol–English and
  English–Bikol; Naga-centred Central Bikol): [ScholarSpace record](https://scholarspace.manoa.hawaii.edu/handle/10125/62856),
  [Project MUSE](https://muse.jhu.edu/book/61273). Entries below quoted from the EPUB (headword, gloss).
- [Wikivoyage Bikol phrasebook](https://en.wikivoyage.org/wiki/Bikol_phrasebook) (Naga/Legazpi variety; Naga forms marked).
- [Central Bikol (Wikipedia)](https://en.wikipedia.org/wiki/Central_Bikol) (dialects, orthography).
- [ABVD Naga Bikol word list](https://abvd.eva.mpg.de/austronesian/language.php?id=1208),
  [ABVD Bikol (Naga City)](https://abvd.eva.mpg.de/austronesian/language.php?id=47).
- Naga City ordinances (official local transport vocabulary): [Ord. 2018-071 padyak](https://www2.naga.gov.ph/prev-ordinance/ordinance-no-2018-071/),
  [fare reduction 2022, "trimobile"/padyak fares](https://www2.naga.gov.ph/riding-public-hails-naga-citys-reduction-of-transport-fare/),
  [Ord. 89-094 terminals](https://www2.naga.gov.ph/prev-ordinance/ordinance-no-89-094/).
- Filipino commuter phrases: [FilipinoPod101 commuting lesson](https://www.filipinopod101.com/lesson/absolute-beginner-16-commuting-in-the-philippines)
  (bayad po, para po, sukli), [Kaiwa: Filipino public transport](https://trykaiwa.com/blog/filipino-public-transportation-realistic),
  [Ling: transportation in Tagalog](https://ling-app.com/blog/transportation-in-tagalog/),
  [GMA: "Pakiabot po ng bayad"](https://gmanetwork.com/news/hashtag/content/897656/netizens-help-commuter-translate-pakiabot-po-ng-bayad/story).
- KWF: *Ortograpiyang Pambansa* (2013) and *KWF Manwal sa Masinop na Pagsulat* (2014) for spelling of loanwords
  ([Filipino orthography, Wikipedia](https://en.wikipedia.org/wiki/Filipino_orthography);
  [Rappler primer](https://www.rappler.com/?p=1190911)); KWF Diksiyonaryo app for headwords
  ([Wiktionary "dyipni" cites KWF Diksiyonaryo 2021](https://wiki.neonvagabond.xyz/content/wiktionary_en_all_nopic_2024-05/A/dyipni)).
  I could not retrieve a KWF entry for "dyip"/"traysikel" directly: reviewer checks in the KWF app.
- Gaps: **no web source documents Naga-specific spoken commuter phrasing** (searches for Bikol "para po"/"bayad"
  usage in Naga returned nothing). Everything in the Bikol column is dictionary-grounded, not usage-grounded, and
  needs a Naga speaker.

### 3.2 Register rules (for drafters and reviewers)

- Filipino: everyday conversational Filipino ("Taglish-light") as used on PH transit apps and signage; polite but no
  stacked `po` on buttons (first-person buttons: "Bumaba na ako"); `po` only in phrases said *to the driver*
  ("Para po", "Bayad po"). Keep English loanwords where commuters use them (Offline, I-save, ruta, terminal). KWF
  spelling for respelled loans (drayber, biyahe), but owner decides jeep vs dyip (Q1).
- Bikol-Naga: Naga forms (initial `h`), `tabì` for please, Spanish numerals for prices and times are normal;
  Filipino/English loanwords acceptable where Naga speakers use them. Diacritics (á, â, ì) are dictionary-only, not
  in UI text (Wikivoyage: diacritics are "normally used in dictionaries and textbooks").
- Never translate: `ParaNaga`, `Para` (the stop word), route codes (`R4`, `C`), `₱`, place and stop names.
- §6.5 carries over: no live/ETA/arriving-style claims in any language; estimates always marked; waiting "unknown";
  "Arrive" wording only for the rider's own confirmation.

### 3.3 Starter glossary (confidence: high = dictionary/official source + common usage; med = one source or sense
mismatch; low = no source / guess. **Every Bikol row needs native review; every `low`/`med` Filipino row too.**)

| # | English | Filipino | Bikol-Naga | Source | Conf. (fil / bcl) |
|---|---|---|---|---|---|
| 1 | Para (stop word) | Para | Para | Mintz PÁRA "stop (a command given to the driver of a moving vehicle)"; FilipinoPod101; Wikivoyage | high / high |
| 2 | Fare | Pamasahe | Pasahe (alt. Plete) | Mintz PASÁHE, PLÉTE "fare"; Jev pilot fil 0.85 | high / med (which is current in Naga?) |
| 3 | Pay / "Fare, please" (to driver) | Bayad po | Bayad tabì | Mintz BÁYAD "to pay"; TÁBI' "please"; FilipinoPod101 | high / med |
| 4 | Change (money back) | Sukli | Suklî | Mintz SUKLÍ' "change (money)"; Kaiwa | high / high |
| 5 | Jeepney | Jeep (KWF: dyip) | Jeep / dyip | Wiktionary dyipni→KWF Diksiyonaryo; common signage | med / med (Q1) |
| 6 | Tricycle (motor) | Tricycle / traysikel | Tricycle | Naga City uses "trimobile" officially; common speech "tricycle" | med / low |
| 7 | Padyak (pedal tricycle) | Padyak | Padyak | Naga Ord. 2018-071, 2022 fare release | high / high |
| 8 | Terminal | Terminal | Terminal | Naga Ord. 89-094 | high / high |
| 9 | Driver | Drayber (alt. tsuper) | Drayber / tsuper | Mintz TSÚPER "a driver, a chauffeur"; KWF respelling | high / med |
| 10 | Stop (place) | Hintuan / babaan | Pundohan (?) / babaan | Mintz PUNDÓ "to stop, to halt"; "pundohan" derived, unattested | med / low |
| 11 | Board / ride ("I boarded R4") | Sumakay ("Nakasakay na ako sa R4") | Lumunad ("Nakalunad na ako sa R4") | Mintz LÚNAD "to ride (on), to embark"; SAKÁY = "ride in a boat"; Jev 0.70 review | high / med |
| 12 | Get off ("I got off") | Bumaba ("Bumaba na ako") | Lumusad ("Nakalusad na ako") | Mintz LÚSAD "to get off (as a bus), to disembark"; Jev fil 0.71, bcl 0.62 (review) | high / med |
| 13 | Walk | Maglakad | Maglakaw | Mintz LAKÁW "to walk"; ABVD Naga "maglakaw" | high / high |
| 14 | Wait | Maghintay | Maghalat | Mintz HALÁT "to wait for"; Jev bcl 0.92 | high / high |
| 15 | Transfer (change jeep) | Lumipat ng sasakyan | Bumalyo sa ibang jeep (?) | Mintz BALYÓ "to transfer, to move from one place to another" | high / low |
| 16 | Near | Malapit | Harani | Mintz RANÍ HA- "near"; ABVD | high / high |
| 17 | Far | Malayo | Harayo | Wikivoyage harayô; ABVD | high / high |
| 18 | Left | Kaliwa | Walá | Mintz, Wikivoyage | high / high |
| 19 | Right | Kanan | Tuó | Mintz TU'Ó, Wikivoyage | high / high |
| 20 | Straight ahead | Diretso | Diretso | Mintz DIRÉTSO, Wikivoyage | high / high |
| 21 | Here | Dito | Digdi | Mintz DIGDÍ | high / high |
| 22 | There | Doon | Duman | Mintz DUMÁN | high / high |
| 23 | Where | Saan | Saen | Wikivoyage | high / high |
| 24 | How much (price) | Magkano | Mangguráno | Wikivoyage | high / high |
| 25 | Please | Paki- / po | Tabì | Mintz TÁBI', Wikivoyage | high / high |
| 26 | Thank you | Salamat | Dios mabalos | Wikivoyage | high / high |
| 27 | Destination | Pupuntahan | Dudumanan | Mintz DUDUMÁNAN "destination" | high / med |
| 28 | I've arrived (rider-confirmed) | Nakarating na ako | Nakaabot na ako | Mintz ABÓT "to arrive, to reach a place" | high / med |
| 29 | Next (stop) | Susunod | Sunod | Mintz SUNÓD "next" | high / high |
| 30 | My stop is next | Susunod na ang babaan ko | Sunod na an lusadan ko (?) | derived; unattested phrase | med / low |
| 31 | I missed my stop | Lumampas ako sa babaan ko | ? (needs speaker) | none | med / low |
| 32 | Estimate (badge) | Tantiya | ? (Mintz KALKULÓ "to estimate" is a verb) | Jev pilot fil **abstain 0.35** (Tantiya 0.51 / Humigit-kumulang 0.26 / Tinatayang 0.23) | low / low |
| 33 | About / approximately (before a number) | Mga ("mga 14–18 min") | Mga | common usage both | med / med |
| 34 | Minutes | minuto (min) | minuto (min) | Mintz MINÚTO | high / high |
| 35 | Unknown / not known | Hindi alam | Dai aram | Mintz ÁRAM "to know"; DAI "no" (Wikivoyage) | high / med |
| 36 | Search | Maghanap / Hanapin | Hanapon | Mintz HÁNAP "to search for" | high / med (verb form) |
| 37 | Help | Tulong | Tabang | Mintz TÁBANG "to help" | high / high |
| 38 | Report (a problem) | I-report / Mag-ulat | I-report | Mintz REPÓRT (E); avoid SUMBÓNG ("to tattle") | high / med |
| 39 | Save (a trip) | I-save | I-save | loan; Mintz TÍPON = save money (wrong sense) | high / med |
| 40 | Trip | Biyahe | Biyahe | Mintz BIÁHE "trip" | high / high |
| 41 | Route | Ruta | Ruta | common usage | high / med |
| 42 | Map | Mapa | Mapa | common usage | high / med |
| 43 | Ask (the driver) | Itanong sa drayber | Ihapot sa drayber | Mintz HAPÓT "to ask about, to inquire" | high / med |
| 44 | Other side of the street | Kabilang panig ng kalye | Balyo kan dalan | Mintz BALYÓ SA "across, on the other side"; DÁLAN "a path" | med / med |
| 45 | Wrong | Mali | Salâ | Mintz SALÁ' | high / high |
| 46 | Now | Ngayon | Ngunyan | Mintz, Wikivoyage | high / high |
| 47 | Yes / No | Oo / Hindi | Iyo / Dai | Wikivoyage | high / high |
| 48 | Offline | Offline | Offline | keep loanword | high / high |
| 49 | Unverified route (badge) | Hindi pa beripikadong ruta | ? | none | med / low |
| 50 | Wait a minute | Sandali lang | Halat mú'na | Mintz HALÁT MÚ'NA | high / high |

The glossary becomes `src/i18n/glossary.ts` (typed rows with `locked: boolean`); drafters must use locked terms and a
test greps each locale for forbidden synonyms (e.g. `fil` must not contain "pasahe" if "pamasahe" is locked).

---

## 4. Jev in the pipeline (Jev scores, never writes)

### 4.1 Flow per key, per locale

1. **Draft** (LLM, sonnet): 2–4 candidates per key, prompt = en string + key path + screen context + locked glossary +
   register rules + §6.5 + length budget. Long-form help articles: opus.
2. **Deterministic filter** (code, no model): placeholder sentinels preserved, banned patterns absent, length budget,
   locked glossary terms used. Failing candidates dropped; if none left → redraft once → else `needs_review`.
3. **Jev** (`jev_ask`, one request per key, pinned model `typesafe/jev-1.14-20261014`):
   - `choice`: "Which candidate is the most natural everyday {Filipino|Central Bikol as spoken in Naga} for this UI context?"
   - `noul`: "Does candidate {X} keep the same meaning as the English, including that the value is only an estimate?"
   - `noul`: "Does candidate {X} claim real-time tracking, an exact arrival time, a guarantee, or official status?" (want NO)
   Decision: **act** only if choice certainty ≥ 0.8 **and** both noul answers act in the right direction; else
   **review**. `bcl` is always `needs_review` regardless of Jev (Jev reads English best; see pilot).
4. **Human**: Filipino reviewer reads every `needs_review` key plus 100 % of P1 guidance/fare/acknowledgment keys;
   Naga Bikol speaker reads every `bcl` key. Reviewer may pick a candidate or write their own (recorded as `human_authored`).
5. **Apply**: a script writes accepted strings into `src/i18n/{fil,bcl}/*.ts`; tests in §1.7 run.

### 4.2 Ledger (`docs/i18n/ledger-fil.json`, `docs/i18n/ledger-bcl.json`, committed)

```json
{ "key": "guidance.gotOff", "en": "I got off", "phase": "P1", "safety": true,
  "candidates": ["Bumaba na ako", "Nakababa na ako", "Lumabas na ako"],
  "filtered": [],
  "jev": { "model": "typesafe/jev-1.14-20261014", "choice": "Bumaba na ako",
           "probabilities": {"0": 0.78, "1": 0.20, "2": 0.01}, "certainty": 0.71, "decision": "review" },
  "chosen": "Bumaba na ako", "status": "native_approved",
  "reviewer": "<name>", "reviewedOn": "2026-10-2x", "glossary": ["get-off"], "sources": ["Mintz LÚSAD"] }
```

`status ∈ draft | jev_accepted | needs_review | native_approved | rejected`. Typed decisions = ADR evidence (Jev+ECC
workflow). The Bikol gate test (§1.7 #5) reads this ledger.

### 4.3 Pilot (run 2026-10-21, `jev_ask`, model `typesafe/jev-1.14-20261014`, act ≥ 0.8, review ≥ 0.5)

| Item | Candidates | Jev choice | Certainty | Decision |
|---|---|---|---|---|
| fil "Fare" label | Pamasahe / Bayad / Plete / Singil | Pamasahe (0.89) | 0.85 | act |
| fil "Estimate" badge | Tantiya / Tinatayang / Humigit-kumulang / Hula | Tantiya (0.51) | 0.35 | **abstain** |
| fil "I got off" | Bumaba na ako / Nakababa na ako / Lumabas… / Umalis… | Bumaba na ako (0.78) | 0.71 | review |
| fil "Say 'Para' to the driver" | keeps Para vs Stop/buzzer/Hinto po | keeps "Para" (0.99) | 0.99 | act |
| bcl "I boarded R4" | Nakalunad / Nakasakay / Nagsakay | Nakalunad (0.80) | 0.70 | review |
| bcl "I got off" | Nakalusad / Nakababa / Nakaluwas | Nakalusad (0.75) | 0.62 | review |
| bcl "Wait here for the jeepney" | Maghalat digdi… / Maghintay dito… (Tagalog) / Halata… | Maghalat digdi kan dyip (0.95) | 0.92 | act |
| "Is 'Maghintay dito ng dyip' Tagalog, not Bikol?" | yes/no | yes (p 0.81) | 0.62 | review |

Findings: (a) Jev is decisive on clear-cut checks (keeps "Para", picks the Bikol over the Tagalog sentence) and
honestly abstains on genuinely contested wording ("Estimate"); (b) the Bikol choices followed the dictionary glosses I
put in `state`, so they show consistency with Mintz, **not** Naga usage; (c) even an obvious language-ID question only
reached 0.62 certainty. Conclusion: Jev is a good triage filter for Filipino and a consistency check for Bikol; it is
not a substitute for the native-speaker gate. Pilot rows are seeded into the ledgers in T6.

---

## 5. Task breakdown

Sizes: S ≤ 2 h, M ≤ 1 day, L ≤ 3 days (agent time). Tier: haiku = mechanical extraction, sonnet = integration,
opus = design/review. Speed-mode rules apply (push to master, local `pnpm typecheck && pnpm test`, affected e2e only).

| # | Task | Size | Tier | Depends | Done when |
|---|---|---|---|---|---|
| T0 | ADR: supersede D8 and spec 03 `next-intl`/`[locale]` rows; update 03-architecture.md, 02-features.md, more-screen comment | S | opus | — | spec + ADR committed |
| T1 | `src/i18n` infra: `locales.ts`, `Dict` type, `resolve()` fallback, dynamic `fil`/`bcl` imports, `LocaleProvider`/`useT`/`useLocale`; migrate existing `messages.ts` users (driver-report-wizard, complaints/notice) | M | sonnet | T0 | typecheck + unit green; English unchanged |
| T2 | Prefs `locale` field + zod + `BIKOL_ENABLED` coercion; `theme-init.js` sets `html lang` | S | sonnet | T1 | prefs tests extended; lang set before paint |
| T3 | Guard tests §1.7 (#1–#7) incl. pseudo-locale helper | M | sonnet | T1 | tests fail on a deliberately missing/English/placeholder-dropped fil key |
| T4 | Switcher: More (`Segmented`) + landing header toggle; verify fil chunk is in `__SW_MANIFEST` and switch works offline (playwright: only the affected spec) | M | sonnet | T2 | toggle persists across reload and offline |
| T5 | `formatLocale` + replace 7 hard-coded Intl locale sites | S | haiku | T1 | dates render `fil-PH` under fil |
| T6 | Glossary file + ledger schema + `scripts/i18n-draft.ts` (LLM drafts → filter → Jev → ledger) + `scripts/i18n-apply.ts`; seed pilot rows | M | sonnet (prompt design: opus) | T3 | dry run on 20 P1 keys writes ledger |
| T7 | P1 extraction: guidance domain + UI (view.ts, announce.ts, steps.ts, ui/guidance/*) with `copy = en.guidance` default params | M | haiku extract, sonnet wire | T1 | all existing guidance tests pass unchanged |
| T8 | P1 extraction: trip + eta format + home + tab bar + kit + status badges/fare chips | L | haiku extract, sonnet wire | T7 | copy-budget test passes in en |
| T9 | P1 Filipino: draft → Jev → human review of 100 % P1 safety keys; fill `fil` P1 | M | sonnet + human | T6, T8 | ledger P1 all `jev_accepted`/`native_approved` |
| T10 | **Filipino P1 review gate** (opus review of copy rules + fluent Filipino reviewer walks a full trip on a phone) → enable `fil` in switcher | S | opus + human | T9 | sign-off recorded in ledger |
| T11 | P2 extraction (search, places, stops, routes, terminals, explore, saved, map, pwa, settings) | L | haiku / sonnet | T8 | en tests green |
| T12 | P2 Filipino translations | M | sonnet + human | T11 | fil complete for P2 |
| T13 | P3 extraction + translations (help articles: opus draft; report/report-driver/reports/community/mynaga/auth; acknowledgments verbatim-reviewed) | L | haiku / sonnet / opus | T12 | fil complete; acknowledgments reviewed |
| T14 | P4 landing extraction + Filipino; decide P5 `/fil` route | M | sonnet | T13 | landing fully fil |
| T15 | Final Filipino review (opus) across all screens at 200 % text size and pseudo-locale overflow check | M | opus | T14 | `fil` 100 %, no `SAME_AS_EN` surprises |
| B1 | Bikol drafting for all keys (glossary-locked, Naga register) → Jev consistency check → ledger `needs_review` | L | sonnet (+ opus for long-form) | T15 | `bcl` ledger complete as drafts |
| B2 | **Native Naga Bikol review** of every key (spreadsheet export of ledger; reviewer edits; re-import) | L (human) | human | B1 | ledger 100 % `native_approved` |
| B3 | Flip `BIKOL_ENABLED`; Bikol gate test green; opus final review; field test with 2–3 Naga commuters | S | opus + human | B2 | Bikol visible in switcher |

Review gates: **G1** after T10 (Filipino P1 live), **G2** after T15 (Filipino complete), **G3 = B2/B3**: Bikol never
ships without a named native Naga speaker's sign-off on every key; the code enforces it (§1.7 #5).

## 6. Risks

- Translation drift: English copy changes after translation leave stale `fil`. Mitigation: ledger stores `en`; a test
  fails when `en` value ≠ ledger `en` for a key (forces re-review).
- Length overflow in chips/cards (fil ~20–35 % longer): length budget test + pseudo-locale.
- Safety wording ("Para", get-off prompts, "missed your stop") mistranslated: 100 % human review in P1.
- Bikol dialect mix (Canaman/Legazpi forms): reviewer from Naga City proper; glossary locked.
- English flash on cold load in fil: measure; only add hiding CSS if visible.

## 7. Open questions for the owner

1. Filipino spelling: everyday **"jeep" / "tricycle"** or KWF-respelled **"dyip" / "traysikel"**? (Naga City itself
   writes "trimobile" and "padyak".)
2. Who are the reviewers: a fluent Filipino reviewer for P1, and a **named native Naga City Bikol speaker** for every
   Bikol key (paid? volunteer? Ateneo de Naga contact)?
3. Missing Bikol key at runtime: fall back to **English** (as briefed) or **Filipino** (closer for Bikol speakers)?
4. First open: always English, or follow the phone language (`fil`/`tl` → Filipino)?
5. Landing SEO: is a separate static `/fil` (later `/bcl`) landing with hreflang wanted, and should landing
   screenshots be re-captured per language?

## Owner decisions (2026-10-22)

1. Filipino uses everyday street words: "jeep", "tricycle" (padyak and para unchanged), not KWF "dyip"/"traysikel".
2. A missing Bikol string falls back to Filipino, then English (supersedes the per-key English fallback above for `bcl`).
3. First open follows the phone language (`navigator.languages`: fil/tl → Filipino, bcl → Bikol once enabled, else English); the choice in More overrides it.
4. Review: Filipino ships after the draft + Jev check; Bikol stays hidden until volunteer native Naga speakers are recruited and sign off.
5. Separate `/fil` landing page: deferred (no decision yet).

## G1 passed (2026-10-22)

T10: opus review (all 468 rows `reviewed: "opus"`, 11 keys left `review: true` for a native Naga speaker: missedStop, useLocation, eta.estAbbr, the eight roadside chips). Owner waived the human walk-through for P1 (volunteers later), so `FILIPINO_ENABLED` is on. P2+ screens stay English until T11-T12.
