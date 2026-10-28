import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { en } from "../../src/i18n/en";
import { fil } from "../../src/i18n/fil";
import { PROVISIONAL_PLAN } from "./fixtures/plan-responses";
import { SEARCH_INDEX, STOP_A1, routeNetwork } from "./fixtures/network";
import { backToMap, panMap, sheetSettled } from "./fixtures/options";

// Final Filipino review (i18n T15): every commuter screen the fixtures reach, in Filipino, with the
// text at 200 %. The app has no text-size setting, so the phone's 200 % text is simulated the way
// Android's font scale works on the page: every px font-size in the stylesheets (and inline) is
// doubled and the root font-size is 200 % (rem and em follow); the layout width stays the phone's.
// On each screen: no horizontal scroll (the page and every vertical scroller), no button / link /
// tab / chip / badge whose text is cut off (unless it ends in an ellipsis on purpose), axe has no
// serious or critical violation, and no visible text is an English dictionary string whose
// Filipino differs (a hard-coded leftover). Admin (/admin) stays English by owner decision.

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const PREFS_KEY = "paranaga.prefs";
const USER = { user: { id: "user-1", name: "Maria", roles: ["commuter"] } };
const COMPLAINT_ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a99";
const POST_ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a01";
const SM = SEARCH_INDEX.osmPlaces.find((p) => p.name === "SM City Naga")!;
const SM_PATH = `/app/places/osm/${SM.key.slice("osm:".length)}`;

type Leaf = string | ((...args: never[]) => string);
type Tree = { readonly [key: string]: Leaf | Tree };
const strings = (tree: Tree, prefix = ""): [string, string][] =>
  Object.entries(tree).flatMap(([key, value]): [string, string][] => {
    const at = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object") return strings(value, at);
    return typeof value === "string" ? [[at, value]] : [];
  });

/** English strings whose Filipino differs: seeing one on a Filipino screen means it is hard-coded. */
const FIL = new Map(strings(fil as unknown as Tree));
const ENGLISH_ONLY = [
  ...new Set(
    strings(en as unknown as Tree)
      .filter(([key, value]) => FIL.get(key) !== value && value.trim().length > 1)
      // A Filipino string that happens to equal some other English string is not a leftover.
      .filter(([, value]) => ![...FIL.values()].includes(value))
      .map(([, value]) => value.replace(/\s+/g, " ").trim()),
  ),
];

/**
 * English seen on purpose (T15 review): server-written text the client shows as it comes, data
 * names and the English screenshots' alt text. Each entry is checked against what a screen shows.
 */
const ACCEPTED_ENGLISH = new Set<string>([]);

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", headers: { "cache-control": "private, no-store" }, body: JSON.stringify(body) });

const complaint = {
  id: COMPLAINT_ID,
  reference: "PN-7KQ4-2M",
  category: "overcharging",
  status: "under_review",
  submittedAt: "2026-10-17T16:00:00.000Z",
  incidentAt: "2026-10-17T14:30:00.000Z",
  description: "Humingi ang driver ng 40 piso para sa maikling biyahe.",
  locationText: "Malapit sa plaza",
  operator: null,
  plate: "ABC 1234",
  bodyNumber: null,
  outcomeCode: null,
  evidence: [{ id: "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a77", captureKind: "in_app_camera" }],
  events: [
    { status: "submitted", at: "2026-10-17T16:00:00.000Z", note: null },
    { status: "under_review", at: "2026-10-18T01:00:00.000Z", note: null },
  ],
  handoff: { submitted: false, submittedAt: null, reference: null },
};
const post = {
  id: POST_ID, seq: 5, topic: "commute_tips", title: "Mas madali ang Loop A bago mag-7 am",
  excerpt: "Madaling makahanap ng upuan bago mag-7 am tuwing weekday.", tags: ["loop-a"], routeCode: "R4", label: "community",
  authorHandle: "Commuter AB12C", isOwn: true, createdAt: "2026-10-17T01:00:00.000Z", helpfulCount: 2, commentCount: 1,
  viewerHelpful: false, viewerBookmarked: false, state: "published", hasPendingEdit: false,
};

/** API answers for the signed-in screens (as in my-reports, community and report specs). */
async function mockApi(page: Page) {
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.abort());
  await routeNetwork(page);
  await page.route("**/api/v1/plan", (route) => json(route, PROVISIONAL_PLAN));
  await page.route("**/api/v1/me", (route) => json(route, USER));
  await page.route("**/api/v1/me/corrections", (route) =>
    json(route, { corrections: [{ id: "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a55", category: "wrong_curb_side", entityType: "stop", entityId: "s1", entityLabel: "Centro", status: "accepted", submittedAt: "2026-10-10T00:00:00.000Z" }] }),
  );
  await page.route("**/api/v1/me/complaints", (route) =>
    json(route, { complaints: [{ id: COMPLAINT_ID, reference: complaint.reference, category: complaint.category, status: complaint.status, submittedAt: complaint.submittedAt, incidentAt: complaint.incidentAt, evidence: complaint.evidence }] }),
  );
  await page.route(`**/api/v1/me/complaints/${COMPLAINT_ID}`, (route) => json(route, { complaint }));
  await page.route("**/api/v1/community/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1/community", "");
    if (path === "/me") return json(route, { guidelinesAccepted: true, blocked: [] });
    if (path === "/posts") return json(route, { posts: [post, { ...post, id: "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a02", isOwn: false, topic: "first_time", title: "Paano magbayad sa jeep", tags: [], routeCode: null }], nextCursor: null });
    if (path === `/posts/${POST_ID}`)
      return json(route, {
        post: { ...post, body: "Madaling makahanap ng upuan bago mag-7 am tuwing weekday. Pagkalipas ng 8, puno na.", versions: [], editDraft: null },
        comments: [{ id: "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a11", parentId: null, depth: 1, authorHandle: "Commuter ZZ9Y8", isOwn: false, body: "Salamat, nakatulong ito.", createdAt: "2026-10-17T02:00:00.000Z", helpfulCount: 0, viewerHelpful: false, state: "published", replies: [] }],
      });
    return json(route, { error: { code: "not_found", message: "No", requestId: "r" } }, 404);
  });
}

/** Filipino on, before any page script; then the 200 % text scaling, re-applied as styles load. */
async function setUp(page: Page) {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("__prefsSeeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("__prefsSeeded", "1");
      }
    },
    [PREFS_KEY, JSON.stringify({ locale: "fil" })] as const,
  );
  await page.addInitScript(() => {
    const done = new WeakSet<object>();
    const double = (value: string) => value.replace(/(-?\d*\.?\d+)px/g, (_, n: string) => `${Number(n) * 2}px`);
    const scaleStyle = (style: CSSStyleDeclaration) => {
      const value = style.getPropertyValue("font-size");
      if (value && /px/.test(value)) style.setProperty("font-size", double(value), style.getPropertyPriority("font-size"));
      const line = style.getPropertyValue("line-height");
      if (line && /px/.test(line)) style.setProperty("line-height", double(line), style.getPropertyPriority("line-height"));
    };
    const scaleRules = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (done.has(rule)) continue;
        done.add(rule);
        if (rule instanceof CSSStyleRule) scaleStyle(rule.style);
        if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) scaleRules((rule as CSSGroupingRule).cssRules);
      }
    };
    const scale = () => {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          scaleRules(sheet.cssRules);
        } catch {
          // A cross-origin sheet cannot be read; the app has none.
        }
      }
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("[style*='font-size']"))) {
        const was = el.dataset.t15Font;
        if (was === el.style.fontSize) continue;
        scaleStyle(el.style);
        el.dataset.t15Font = el.style.fontSize;
      }
      document.documentElement.style.fontSize = "200%";
    };
    (window as unknown as { __t15Scale: () => void }).__t15Scale = scale;
    const start = () => {
      scale();
      new MutationObserver(scale).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "href"] });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  });
  await mockApi(page);
}

/** The Filipino dictionary is showing and the text is at 200 %. */
async function ready(page: Page, what: string | Locator) {
  await expect(page.locator("html")).toHaveAttribute("lang", "fil");
  await expect(typeof what === "string" ? page.getByText(what, { exact: false }).first() : what).toBeVisible();
  await page.evaluate(() => (window as unknown as { __t15Scale: () => void }).__t15Scale());
  // Time-based animations only (the landing page's reveals run on scroll timelines).
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => !(a.timeline instanceof DocumentTimeline) || a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
}

type Problems = { sideways: string[]; clipped: string[]; english: string[] };

async function measure(page: Page): Promise<Problems> {
  return page.evaluate((englishOnly) => {
    // Visually hidden text (.sr-only, 1 px boxes) is for screen readers and cannot be cut off on screen.
    const visible = (el: Element) => {
      const box = el.getBoundingClientRect();
      return box.width > 2 && box.height > 2 && el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && !el.closest("[inert], [aria-hidden='true']");
    };
    const name = (el: Element) => {
      const h = el as HTMLElement;
      const id = h.dataset.testid ? `[data-testid=${h.dataset.testid}]` : "";
      const cls = typeof h.className === "string" && h.className ? `.${h.className.trim().split(/\s+/).join(".")}` : "";
      return `${el.tagName.toLowerCase()}${id}${cls} “${(h.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60)}”`;
    };
    const sideways: string[] = [];
    /** The deepest descendants that stick out past the right edge of `box` (the cause of a sideways scroll). */
    const culprits = (box: Element) => {
      const right = box.getBoundingClientRect().right + 1;
      const clippedInside = (el: Element) => {
        for (let up = el.parentElement; up && up !== box; up = up.parentElement) if (getComputedStyle(up).overflowX !== "visible") return true;
        return false;
      };
      const out = Array.from(box.querySelectorAll("*")).filter((el) => visible(el) && el.getBoundingClientRect().right > right && !clippedInside(el));
      return out
        .filter((el) => !out.some((other) => other !== el && el.contains(other)))
        .slice(0, 3)
        .map(name)
        .join(" ; ");
    };
    const root = document.scrollingElement!;
    if (root.scrollWidth > root.clientWidth + 1) sideways.push(`page ${root.scrollWidth} > ${root.clientWidth}: ${culprits(document.body)}`);
    const clipped: string[] = [];
    const controls = "button, a, label, summary, [role=tab], [role=radio], [role=button], [role=link], [role=switch], [class*=chip], [class*=badge], [class*=pill], [class*=tab], h1, h2, h3";
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      if (el.closest(".leaflet-container") && !el.closest(".leaflet-control-container")) continue;
      const style = getComputedStyle(el);
      // A scroll box (a sheet, a panel) must not scroll sideways; a chip row scrolls sideways on purpose.
      const scroller = /auto|scroll/.test(style.overflowY) && !/chips/.test(typeof el.className === "string" ? el.className : "");
      if (scroller && visible(el) && el.scrollWidth > el.clientWidth + 1) sideways.push(`${name(el)} ${el.scrollWidth} > ${el.clientWidth}: ${culprits(el)}`);
      if (!el.matches(controls) || !visible(el)) continue;
      if (/auto|scroll/.test(style.overflowX)) continue; // a chip row that scrolls sideways on purpose
      if (style.textOverflow === "ellipsis") continue;
      if (!el.textContent?.trim()) continue;
      if (el.scrollWidth > el.clientWidth + 1) clipped.push(`${name(el)} ${el.scrollWidth} > ${el.clientWidth}`);
    }
    const english = new Set<string>();
    const wanted = new Set(englishOnly);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text || !wanted.has(text)) continue;
      const parent = node.parentElement!;
      if (parent.closest("[lang='en'], script, style, noscript") || !visible(parent)) continue;
      english.add(text);
    }
    return { sideways, clipped, english: [...english] };
  }, ENGLISH_ONLY);
}

async function expectAxeClean(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
}

/** Every check on the screen as it is now. */
async function check(page: Page, screen: string) {
  const problems = await measure(page);
  const english = problems.english.filter((text) => !ACCEPTED_ENGLISH.has(text));
  test.info().annotations.push({ type: `english on ${screen}`, description: problems.english.join(" | ") || "none" });
  expect.soft(problems.sideways, `${screen}: horizontal scroll`).toEqual([]);
  expect.soft(problems.clipped, `${screen}: clipped text`).toEqual([]);
  expect.soft(english, `${screen}: English left in Filipino mode`).toEqual([]);
  await expectAxeClean(page);
}

const homeMap = (page: Page) => page.getByTestId("home-screen").getByTestId("naga-map");
const sheet = (page: Page) => page.getByTestId("trip-sheet");
const chooseOnMap = (page: Page) => page.getByTestId("search-screen").getByRole("button", { name: fil.search.chooseOnMap, exact: true });

/** Both ends by pins, in Filipino (fixtures/options.ts pinTrip, with the Filipino button names). */
async function pinTrip(page: Page) {
  await page.getByTestId("home-search").click();
  await chooseOnMap(page).click();
  await panMap(page, -120, 80);
  await page.getByRole("button", { name: fil.home.setDestinationHere }).click();
  await page.getByTestId("endpoint-start").locator(".pn-endpoint__main").click();
  await chooseOnMap(page).click();
  await panMap(page, 120, -80);
  await page.getByRole("button", { name: fil.home.setStartHere }).click();
  await expect(page.getByTestId("options-toggle")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await setUp(page);
});

test("landing page", async ({ page }) => {
  await page.goto("/");
  await ready(page, fil.landing.hero.titleA);
  await check(page, "landing");
});

test("home map, trip sheet, options, detail, guidance walk and ride, then Saved", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/app");
  await expect(homeMap(page)).toHaveAttribute("data-zoom", /\d/);
  await ready(page, fil.shell.tabs.explore);
  await check(page, "home map");

  await pinTrip(page);
  await sheetSettled(page);
  await ready(page, fil.trip.allOptions);
  await check(page, "trip sheet (peek)");

  await page.getByTestId("options-toggle").click();
  await expect(page.getByTestId("options-toggle")).toHaveAttribute("aria-expanded", "true");
  await sheetSettled(page);
  await ready(page, page.getByTestId("trip-option").first());
  await check(page, "trip options");

  await page.getByTestId("trip-option").first().click();
  await expect(page.getByTestId("trip-detail")).toBeVisible();
  await sheetSettled(page);
  await ready(page, fil.trip.startTrip);
  await check(page, "trip detail");
  await page.getByTestId("trip-save").click();
  await expect(page.getByTestId("trip-save")).toHaveAttribute("data-state", "saved");

  await page.getByTestId("trip-start").click();
  await expect(page.getByTestId("guidance")).toBeVisible();
  await ready(page, fil.guidance.atStop);
  await check(page, "guidance walk");
  await page.getByRole("button", { name: fil.guidance.atStop, exact: true }).click();
  // The fixture's first stop is the start: "I'm at the stop" goes on to the ride, or to the wait.
  const boarded = sheet(page).getByRole("button", { name: /^Nakasakay sa / });
  await expect(sheet(page).getByRole("button", { name: fil.guidance.gotOffEarly }).or(boarded)).toBeVisible();
  if (await boarded.isVisible()) await boarded.click();
  await ready(page, fil.guidance.gotOffEarly);
  await check(page, "guidance ride");

  // End guidance and go to Saved with the trip on it.
  await sheet(page).getByRole("button", { name: fil.guidance.endGuidance }).click();
  const confirm = page.getByRole("button", { name: fil.guidance.endGuidance, exact: true }).last();
  if (await confirm.isVisible()) await confirm.click();
  await backToMap(page).catch(async () => page.goto("/app"));
  await page.getByRole("navigation", { name: fil.shell.mainNav }).getByRole("link", { name: fil.shell.tabs.saved, exact: true }).click();
  await expect(page.getByTestId("saved-trip")).toHaveCount(1);
  await ready(page, fil.saved.tripsIntro);
  await check(page, "saved");
});

test("search with results", async ({ page }) => {
  await page.goto("/app/search?for=destination");
  await ready(page, fil.search.chooseOnMap);
  await page.getByPlaceholder(fil.search.placeholder).fill("plaza rizal");
  await expect(page.getByTestId("search-group-places")).toBeVisible();
  await check(page, "search");
});

for (const [screen, path, text] of [
  ["explore", "/app/explore", fil.explore.intro],
  ["stop detail", `/app/stops/${STOP_A1.stop.id}`, fil.stops.servingTitle],
  ["route detail", "/app/routes/R1", fil.routes.fare],
  ["route detail (loop)", "/app/routes/R8-A", fil.routes.fare],
  ["place detail", SM_PATH, fil.places.directionsTo],
  ["terminal detail", "/app/terminals/T01", fil.terminals.directionsToHere],
  ["leaving Naga", "/app/leaving", fil.intercity.intro],
  ["leaving Naga detail", "/app/leaving?to=D-LEGAZPI", fil.intercity.notRunning],
  ["more / settings", "/app/more", fil.settings.general],
  ["help", "/app/help", fil.help.reportDriverLink],
  ["help safety", "/app/help?tab=safety", fil.help.tipsTitle],
  ["help article (trips)", "/app/help/how-trips-are-planned", fil.help.articles.planned.title],
  ["help article (vehicles)", "/app/help/vehicle-types-in-naga", fil.help.articles.vehicles.title],
  ["sources", "/app/help/sources", fil.sources.registerTitle],
  ["report correction", "/app/report?type=stop&id=stop-101&label=Plaza%20Rizal", fil.report.pickClosest],
  ["report driver", "/app/report-driver", fil.driverReport.steps.start],
  ["my reports", "/app/reports", fil.reports.intro],
  ["report detail", `/app/reports/complaint/${COMPLAINT_ID}`, fil.reports.whatYouReported],
  ["community", "/app/community", fil.community.newPost],
  ["community post", `/app/community/${POST_ID}`, fil.community.commentsLabel],
  ["community new post", "/app/community/new", fil.community.titleLabel],
  ["MyNaga", "/app/mynaga", fil.mynaga.prepareTitle],
  ["MyNaga handoff", `/app/mynaga?report=${COMPLAINT_ID}`, fil.mynaga.copySummary],
  ["sign in", "/app/sign-in", fil.auth.lead],
  ["offline page", "/offline", fil.pwa.pageTitle],
] as const) {
  test(screen, async ({ page }) => {
    await page.goto(path);
    await ready(page, text);
    await check(page, screen);
  });
}
