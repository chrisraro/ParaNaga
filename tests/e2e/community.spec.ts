import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { routeNetwork } from "./fixtures/network";

// Community hub (S17, task B7): feed, thread and composer. The API is answered with page routes, so
// no database is needed. Tiles are aborted. Every test checks for CSP (report-only) violations.

const TILE_RE = /tile\.openstreetmap\.org|api\.maptiler\.com/;
const PREFS_KEY = "paranaga.prefs";
const POST_ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a01";
const OWN_ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a02";
const C1 = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a11";
const C2 = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a12";
const USER = { user: { id: "user-1", name: "Maria", roles: ["commuter"] } };

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const summary = (over: Record<string, unknown> = {}) => ({
  id: POST_ID, seq: 5, topic: "commute_tips", title: "Loop A is easier before 7 am",
  excerpt: "Seats are easy to find before 7 am on weekdays.", tags: ["loop-a"], routeCode: "R4", label: "community",
  authorHandle: "Commuter AB12C", isOwn: false, createdAt: "2026-10-17T01:00:00.000Z", helpfulCount: 2, commentCount: 2,
  viewerHelpful: false, viewerBookmarked: false, state: "published", hasPendingEdit: false, ...over,
});
const FEED = { posts: [summary(), summary({ id: OWN_ID, seq: 4, topic: "first_time", title: "How do I pay on a jeepney", tags: [], routeCode: null })], nextCursor: null };
const comment = (id: string, parentId: string | null, depth: number, body: string, replies: unknown[] = []) => ({
  id, parentId, depth, authorHandle: "Commuter ZZ9Y8", isOwn: false, body, createdAt: "2026-10-17T02:00:00.000Z",
  helpfulCount: 0, viewerHelpful: false, state: "published", replies,
});
const DETAIL = {
  post: { ...summary(), body: "Seats are easy to find before 7 am on weekdays. After 8 it fills up.", versions: [], editDraft: null },
  comments: [comment(C1, null, 1, "Thanks, this helped.", [comment(C2, C1, 2, "Same on Loop B.")])],
};

// N6: an own post whose newest version was not published (appeal once), with one approved photo
// (served from /api/v1/community/photos) and one still waiting (state only, no image).
const PHOTO_ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a21";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const OWN_REJECTED = {
  post: {
    ...summary({ id: OWN_ID, isOwn: true, state: "rejected", title: "Fare increase on R4" }),
    body: "The new fare on R4 is too high for students.",
    versions: [{ id: C2, n: 1, title: "Fare increase on R4", state: "rejected", isLive: false, submittedAt: "2026-10-17T01:00:00.000Z", appeal: null }],
    editDraft: { title: "Fare increase on R4", body: "The new fare on R4 is too high for students.", tags: [] },
    photos: [
      { id: PHOTO_ID, state: "published", appeal: null },
      { id: C1, state: "pending", appeal: null },
    ],
  },
  comments: [],
};

type Mock = { signedIn: boolean; guidelinesAccepted?: boolean; sent: { url: string; method: string; body: unknown }[] };

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(body) });

async function mockApi(page: Page, mock: Mock) {
  await page.route(TILE_RE, (route) => route.abort());
  await routeNetwork(page);
  await page.route("**/api/v1/me", (route) => json(route, mock.signedIn ? USER : { user: null }));
  await page.route("**/api/v1/community/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace("/api/v1/community", "");
    const body = req.postData() ? (req.postDataJSON() as unknown) : null;
    if (req.method() !== "GET") mock.sent.push({ url: path, method: req.method(), body });
    if (path === "/me") return mock.signedIn ? json(route, { guidelinesAccepted: mock.guidelinesAccepted ?? true, blocked: [] }) : json(route, { error: { code: "unauthorized", message: "Sign in", requestId: "r" } }, 401);
    if (path === "/posts" && req.method() === "GET") return json(route, FEED);
    if (path === "/posts" && req.method() === "POST")
      return json(route, { post: { id: OWN_ID, state: "pending", isEdit: false, visibleToOthers: false } }, 201);
    if (path === `/posts/${POST_ID}` && req.method() === "GET") return json(route, DETAIL);
    if (path === `/posts/${OWN_ID}` && req.method() === "GET") return json(route, OWN_REJECTED);
    if (path === "/appeals") return json(route, { appeal: { id: C1, state: "open" } }, 201);
    if (path === `/photos/${PHOTO_ID}`) return route.fulfill({ status: 200, contentType: "image/png", headers: { "cache-control": "public, max-age=300" }, body: PNG });
    if (path === `/posts/${POST_ID}/comments`) return json(route, { comment: { id: C1, state: "pending", depth: 1 } }, 201);
    if (path === "/reactions") return json(route, { active: true, count: 3 });
    if (path === "/bookmarks") return json(route, { active: true, count: null });
    if (path === "/reports") return json(route, { ok: true }, 201);
    return json(route, { error: { code: "not_found", message: "No", requestId: "r" } }, 404);
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
});

test.afterEach(async ({ page }) => {
  const violations = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => []);
  expect(violations, "CSP (report-only) violations").toEqual([]);
});

async function expectAxeClean(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
}

test.describe("feed", () => {
  test("a guest reads published posts, filters by topic, and has a Community tab with 44 px targets", async ({ page }) => {
    const mock: Mock = { signedIn: false, sent: [] };
    await mockApi(page, mock);
    await page.goto("/app/community");
    await expect(page.getByRole("heading", { level: 1, name: "Community" })).toBeFocused();
    await expect(page.getByTestId("community-post")).toHaveCount(2);
    await expect(page.getByTestId("community-disclaimer")).toContainText("Not verified by ParaNaga");
    await expect(page.getByTestId("community-bookmark")).toHaveCount(0);

    const tab = page.getByTestId("tab-community");
    await expect(tab).toHaveAttribute("aria-current", "page");
    for (const name of ["Map", "Explore", "Saved", "Community", "More"]) {
      const box = await page.getByTestId("tab-bar").getByRole("link", { name }).boundingBox();
      expect(box!.width, name).toBeGreaterThanOrEqual(44);
      expect(box!.height, name).toBeGreaterThanOrEqual(44);
    }
    const viewport = page.viewportSize()!;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);

    let asked = "";
    await page.route("**/api/v1/community/posts?*", (route) => {
      asked = route.request().url();
      return json(route, { posts: [FEED.posts[1]], nextCursor: null });
    });
    await page.getByRole("button", { name: "First-time questions" }).click();
    await expect(page.getByTestId("community-post")).toHaveCount(1);
    expect(asked).toContain("topic=first_time");
    expect(asked).not.toContain("me=1");
  });

  test("a signed-in commuter sees Save and the personal scopes", async ({ page }) => {
    const mock: Mock = { signedIn: true, sent: [] };
    await mockApi(page, mock);
    await page.goto("/app/community");
    await expect(page.getByRole("button", { name: "My posts" })).toBeVisible();
    await page.getByTestId("community-bookmark").first().click();
    await expect(page.getByTestId("community-bookmark").first()).toHaveAttribute("aria-pressed", "true");
    expect(mock.sent.some((s) => s.url === "/bookmarks")).toBe(true);
  });
});

test.describe("thread", () => {
  test("shows two comment levels and lets a signed-in commuter react, comment and report", async ({ page }) => {
    const mock: Mock = { signedIn: true, sent: [] };
    await mockApi(page, mock);
    await page.goto(`/app/community/${POST_ID}`);
    await expect(page.getByTestId("thread-body")).toContainText("Seats are easy");
    await expect(page.getByTestId("thread-disclaimer")).toContainText("Not verified by ParaNaga");
    await expect(page.getByTestId("comment")).toHaveCount(2);
    // The reply (level 2) has no Reply button: only two levels.
    await expect(page.getByTestId("comment-reply")).toHaveCount(1);

    await page.getByTestId("thread-helpful").click();
    await expect(page.getByTestId("thread-helpful")).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("textbox", { name: "Your comment" }).fill("Good tip, thank you.");
    await page.getByTestId("comment-send").click();
    await expect(page.getByTestId("comment-sent")).toContainText("Awaiting review");
    expect(mock.sent.find((s) => s.url.endsWith("/comments"))?.body).toMatchObject({ body: "Good tip, thank you.", guidelinesAccepted: true });

    await page.getByTestId("thread-body").scrollIntoViewIfNeeded();
    await page.locator("article summary", { hasText: "More" }).click();
    await page.getByTestId("thread-report").click();
    await expect(page.getByTestId("report-form")).toBeVisible();
    await expect(page.getByRole("radio").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("report-form")).toHaveCount(0);
    await expect(page.getByTestId("thread-report")).toBeFocused();
  });

  test("a guest can read but is asked to sign in to take part", async ({ page }) => {
    await mockApi(page, { signedIn: false, sent: [] });
    await page.goto(`/app/community/${POST_ID}`);
    await expect(page.getByTestId("comment")).toHaveCount(2);
    await expect(page.getByTestId("thread-helpful")).toHaveCount(0);
    await expect(page.getByTestId("community-signin")).toBeVisible();
  });
});

test.describe("moderation outcomes (N6)", () => {
  test("the author of a post that was not published asks for another review once; approved photos show, pending ones do not", async ({ page }) => {
    const mock: Mock = { signedIn: true, sent: [] };
    await mockApi(page, mock);
    await page.goto(`/app/community/${OWN_ID}`);
    await expect(page.getByTestId("thread-state")).toContainText("Not published");
    await expect(page.getByTestId("thread-photos").getByRole("img", { name: "Photo 1 from the author" })).toBeVisible();
    await expect(page.getByTestId("thread-own-photo")).toContainText("Photo awaiting review");
    await expect(page.getByTestId("thread-own-photo").getByRole("img")).toHaveCount(0);

    await page.getByTestId("appeal-open").click();
    await page.getByLabel("Why should it be published?").fill("short");
    await page.getByTestId("appeal-send").click();
    await expect(page.getByTestId("appeal-form")).toContainText("at least 10");
    await page.getByLabel("Why should it be published?").fill("It is about the fare, not about any person.");
    await page.getByTestId("appeal-send").click();
    await expect(page.getByTestId("appeal-state")).toContainText("A different person will review it.");
    expect(mock.sent.find((s) => s.url === "/appeals")?.body).toEqual({ targetType: "post_version", targetId: C2, note: "It is about the fare, not about any person." });
  });
});

test.describe("composer", () => {
  test("asks for the guidelines first, then posts and shows 'Awaiting review'", async ({ page }) => {
    const mock: Mock = { signedIn: true, guidelinesAccepted: false, sent: [] };
    await mockApi(page, mock);
    await page.goto("/app/community/new");
    await expect(page.getByRole("heading", { level: 2, name: "Before you post" })).toBeVisible();
    await page.getByTestId("composer-continue").click();
    await expect(page.getByTestId("composer-error")).toContainText("Tick the box");
    await page.getByTestId("guidelines-ack").check();
    await page.getByTestId("composer-continue").click();
    await expect(page.getByRole("heading", { level: 2, name: "New post" })).toBeFocused();

    await page.getByTestId("composer-send").click();
    await expect(page.getByTestId("composer-error")).toContainText("Choose a topic");
    await page.getByRole("radio", { name: /Commute tips/ }).check();
    await page.getByLabel("Title").fill("Loop A is easier before 7 am");
    await page.getByLabel("Your post").fill("Seats are easy to find before 7 am on weekdays.");
    await page.getByLabel(/Tags/).fill("Loop-A fares");
    await page.getByTestId("composer-send").click();

    await expect(page.getByRole("heading", { level: 2, name: "Post sent" })).toBeFocused();
    await expect(page.getByTestId("composer-state")).toContainText("Awaiting review");
    expect(mock.sent[0]?.body).toMatchObject({ topic: "commute_tips", tags: ["loop-a", "fares"], guidelinesAccepted: true });
  });

  test("a guest is asked to sign in", async ({ page }) => {
    await mockApi(page, { signedIn: false, sent: [] });
    await page.goto("/app/community/new");
    await expect(page.getByTestId("composer-guest")).toBeVisible();
  });
});

for (const scheme of ["light", "dark"] as const) {
  test(`feed, thread and composer pass axe: ${scheme}`, async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => {
        if (!sessionStorage.getItem("__prefsSeeded")) {
          localStorage.setItem(key, value);
          sessionStorage.setItem("__prefsSeeded", "1");
        }
      },
      [PREFS_KEY, JSON.stringify({ theme: scheme })] as const,
    );
    await mockApi(page, { signedIn: true, guidelinesAccepted: false, sent: [] });
    await page.goto("/app/community");
    await expect(page.getByTestId("community-post")).toHaveCount(2);
    await expectAxeClean(page);

    await page.goto(`/app/community/${POST_ID}`);
    await expect(page.getByTestId("comment")).toHaveCount(2);
    await expectAxeClean(page);

    await page.goto("/app/community/new");
    await expect(page.getByTestId("guidelines")).toBeVisible();
    await expectAxeClean(page);
    await page.getByTestId("guidelines-ack").check();
    await page.getByTestId("composer-continue").click();
    await expect(page.getByLabel("Title")).toBeVisible();
    await expectAxeClean(page);
  });
}
