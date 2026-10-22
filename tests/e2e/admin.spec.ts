import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { routeNetwork } from "./fixtures/network";

// Admin console, N5a (C1 dashboard, C8 revisions + publication, A13 coverage), desktop only. The
// e2e server has no Neon Auth and no database, so:
//   - the /admin SHELL takes the roles from a cookie, only because the e2e build sets the test-only
//     PARANAGA_E2E_ADMIN_SHELL=1 (refused in deployment builds, src/domain/pwa/build-guard.ts);
//   - every /api/v1/admin/** call (the real security boundary) is answered by page routes here,
//     with the production headers. tests/unit/admin-handlers.test.ts and
//     tests/integration/admin-revisions-rls.test.ts cover the real checks behind them.
// Covers: a 404 status for signed-out visitors and the plain not-found page for non-staff, the dashboard counts, validate → report,
// publish → step-up → success, rollback offered for superseded revisions, coverage, axe in light
// and dark, and that /admin is never cached.

const ROLES_COOKIE = "pn-e2e-admin-roles";
const PRIVATE = { "cache-control": "private, no-store" };
const PUB = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a11";
const DRAFT = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a22";
const OLD = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a33";

test.skip(({ isMobile }) => isMobile, "The admin console is desktop-first");

async function signInAs(context: BrowserContext, roles: string) {
  await context.addCookies([{ name: ROLES_COOKIE, value: roles, domain: "localhost", path: "/" }]);
}

type Row = Record<string, unknown> & { id: string; label: string; status: string; isPublished: boolean };

function revisionsState() {
  const rows: Row[] = [
    { id: DRAFT, seq: 3, label: "draft-2026-10-22-100000", kind: "provisional", status: "draft", createdAt: "2026-10-22T02:00:00.000Z", publishedAt: null, parentId: PUB, isSynthetic: false, memberCount: 812, isPublished: false, validation: null },
    { id: PUB, seq: 2, label: "modes-lines-2026-10-16", kind: "provisional", status: "published", createdAt: "2026-10-16T02:00:00.000Z", publishedAt: "2026-10-16T03:00:00.000Z", parentId: null, isSynthetic: false, memberCount: 812, isPublished: true, validation: null },
    { id: OLD, seq: 1, label: "provisional-loops-2026-10-15", kind: "provisional", status: "superseded", createdAt: "2026-10-15T02:00:00.000Z", publishedAt: "2026-10-15T03:00:00.000Z", parentId: null, isSynthetic: false, memberCount: 300, isPublished: false, validation: null },
  ];
  return { rows, verified: false, codesSent: 0, published: [] as unknown[] };
}

async function mockAdminApi(page: Page) {
  const s = revisionsState();
  const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", headers: PRIVATE, body: JSON.stringify(body) });
  const err = (status: number, code: string, message: string) => json({ error: { code, message, requestId: "e2e" } }, status);
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (r) => r.abort());
  await routeNetwork(page);
  await page.route("**/api/v1/admin/dashboard", (r) =>
    r.fulfill(
      json({
        published: { id: PUB, seq: 2, label: "modes-lines-2026-10-16", kind: "provisional", publishedAt: "2026-10-16T03:00:00.000Z" },
        drafts: 1,
        latestDraft: { id: DRAFT, label: "draft-2026-10-22-100000", createdAt: "2026-10-22T02:00:00.000Z", validationOk: null, validatedAt: null, validationCurrent: null },
        stopsTotal: 128,
        stopCandidates: 128,
        openCorrections: 3,
        lastImport: { snapshotVersion: "mymaps:naga:2026-10-15", mode: "commit", status: "committed", startedAt: "2026-10-15T01:00:00.000Z", finishedAt: "2026-10-15T01:02:00.000Z" },
      }),
    ),
  );
  await page.route("**/api/v1/admin/revisions", (r) =>
    r.fulfill(json({ publishedId: s.rows.find((x) => x.isPublished)?.id ?? null, revisions: s.rows })),
  );
  await page.route(/\/api\/v1\/admin\/revisions\/[^/]+\/validate$/, (r) => {
    const id = r.request().url().split("/").at(-2)!;
    const row = s.rows.find((x) => x.id === id)!;
    row.validation = { ok: true, validatedAt: "2026-10-22T02:05:00.000Z", errorCount: 0, warningCount: 2, current: true };
    return r.fulfill(
      json({
        revisionId: id,
        label: row.label,
        kind: "provisional",
        ok: true,
        errorCount: 0,
        warningCount: 2,
        issues: [
          { rule: "missing_fare_evidence", severity: "warning", ref: "R5 inbound", message: "No fare rule for the route's mode and no reported fare for the route." },
          { rule: "disconnected_shape", severity: "warning", ref: "R3 outbound", message: "The path could not be traced as one continuous line." },
        ],
        rules: [
          { id: "synthetic", title: "Synthetic (test) rows", severity: "error", count: 0 },
          { id: "missing_fare_evidence", title: "Variant with no fare evidence for its route", severity: "warning", count: 1 },
          { id: "disconnected_shape", title: "Disconnected path (trace not continuous)", severity: "warning", count: 1 },
        ],
        deferred: [
          { id: "opposite_direction_boarding", title: "Opposite-direction boarding", reason: "Needs curb sides and reviewed directed shapes (C3, C4); no stop has a curb side yet." },
          { id: "disruption_without_expiry", title: "Disruption without expiry", reason: "There are no disruptions yet (C7); the table will require an end time." },
        ],
        validatedAt: "2026-10-22T02:05:00.000Z",
      }),
    );
  });
  await page.route(/\/api\/v1\/admin\/revisions\/[^/]+\/(publish|rollback)$/, (r) => {
    if (!s.verified) return r.fulfill(err(403, "step_up_required", "Enter a new code from your email to continue."));
    const parts = r.request().url().split("/");
    const id = parts.at(-2)!;
    const mode = parts.at(-1)!;
    s.published.push({ id, mode, body: r.request().postDataJSON() });
    const prev = s.rows.find((x) => x.isPublished)!;
    prev.isPublished = false;
    prev.status = "superseded";
    const row = s.rows.find((x) => x.id === id)!;
    row.isPublished = true;
    row.status = "published";
    row.publishedAt = "2026-10-22T02:06:00.000Z";
    return r.fulfill(json({ mode, revisionId: id, previousRevisionId: prev.id, head: { revisionId: id, label: row.label, kind: "provisional", publishedAt: "2026-10-22T02:06:00.000Z" } }));
  });
  await page.route("**/api/v1/admin/coverage", (r) =>
    r.fulfill(
      json({
        revisionId: PUB,
        label: "modes-lines-2026-10-16",
        rows: [
          { barangay: "Abella", surveyStatus: "not_surveyed", exactBoardingPointsVerified: false },
          { barangay: "Bagumbayan Norte", surveyStatus: "not_surveyed", exactBoardingPointsVerified: null },
        ],
      }),
    ),
  );
  await page.route("**/api/v1/me/step-up/code", (r) => {
    s.codesSent += 1;
    return r.fulfill(json({ sent: true }));
  });
  await page.route("**/api/v1/me/step-up", (r) => {
    s.verified = true;
    return r.fulfill(json({ verifiedUntil: "2026-10-22T02:20:00.000Z" }));
  });
  return s;
}

async function axe(page: Page, testId: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).include('[data-testid="admin-shell"]').analyze();
  expect(results.violations, `${testId}: ${results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`).join("; ")}`).toEqual([]);
}

test("signed-out visitors get a 404 status; signed-in non-staff get the ordinary not-found page and no admin call", async ({ page, context }) => {
  for (const path of ["/admin", "/admin/revisions", "/admin/coverage"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
  }
  const adminCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/admin")) adminCalls.push(r.url());
  });
  for (const roles of ["commuter", "commuter,community_moderator,complaint_reviewer,contributor"]) {
    await context.clearCookies();
    await signInAs(context, roles);
    for (const path of ["/admin", "/admin/revisions", "/admin/coverage"]) {
      await page.goto(path);
      // The same page as any unknown URL (Cache Components streams it, so the status stays 200, with noindex).
      await expect(page.getByRole("heading", { level: 1 }), `${roles} ${path}`).toHaveText("Wrong stop.");
      await expect(page.getByTestId("admin-shell")).toHaveCount(0);
      await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
      expect(await page.title()).not.toMatch(/admin/i);
    }
  }
  expect(adminCalls).toEqual([]);
});

test("the dashboard shows the counts, is private, and passes axe", async ({ page, context }) => {
  await signInAs(context, "commuter,admin");
  await mockAdminApi(page);
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(200);
  expect(res?.headers()["cache-control"] ?? "").toMatch(/private|no-store/);
  expect(res?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page).toHaveTitle("Dashboard · Admin · ParaNaga");
  await expect(page.getByTestId("published-label")).toHaveText("modes-lines-2026-10-16");
  await expect(page.getByTestId("stop-candidates")).toHaveText("128");
  await expect(page.getByTestId("open-corrections")).toHaveText("3");
  await expect(page.getByTestId("import-snapshot")).toHaveText("mymaps:naga:2026-10-15");
  await expect(page.getByTestId("admin-roles")).toHaveText("Signed in as admin");
  await expect(page.getByTestId("admin-nav").getByRole("link")).toHaveText(["Dashboard", "Revisions & publication", "Coverage audit"]);
  await expect(page.getByTestId("admin-nav").getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  await axe(page, "dashboard");
});

test("validate a draft, publish it after step-up; rollback is offered on superseded revisions", async ({ page, context }) => {
  await signInAs(context, "commuter,transport_reviewer");
  const s = await mockAdminApi(page);
  await page.goto("/admin/revisions");
  const draft = page.getByTestId("revision-draft-2026-10-22-100000");
  await expect(draft).toContainText("Not validated");
  await expect(page.getByTestId("publish-draft-2026-10-22-100000")).toBeDisabled();
  await expect(page.getByTestId("rollback-provisional-loops-2026-10-15")).toBeDisabled();
  await expect(page.getByTestId("revision-modes-lines-2026-10-16")).toContainText("Published (live)");
  await expect(page.getByTestId("create-draft")).toBeDisabled(); // a draft is already open

  await page.getByTestId("validate-draft-2026-10-22-100000").click();
  await expect(page.getByTestId("validation-ok")).toContainText("No errors, 2 warnings");
  await expect(page.getByTestId("validation-issues")).toContainText("R5 inbound");
  await expect(page.getByTestId("validation-deferred")).toContainText("Opposite-direction boarding");
  await expect(draft).toContainText("Passed");

  await page.getByTestId("publish-draft-2026-10-22-100000").click();
  await expect(page.getByTestId("confirm-publication")).toContainText("It replaces modes-lines-2026-10-16 for every rider");
  await page.getByTestId("confirm-publication-go").click();
  await expect(page.getByTestId("admin-step-up")).toBeVisible();
  expect(s.published).toEqual([]);
  await page.getByTestId("admin-step-up-send").click();
  await page.getByTestId("admin-step-up-code").fill("123456");
  await page.getByTestId("admin-step-up-verify").click();

  await expect(page.getByTestId("admin-notice")).toContainText("Published draft-2026-10-22-100000. The public head now names it");
  expect(s.codesSent).toBe(1);
  expect(s.published).toEqual([{ id: DRAFT, mode: "publish", body: { expectedPublishedId: PUB } }]);
  await expect(draft).toContainText("Published (live)");
  await expect(page.getByTestId("revision-modes-lines-2026-10-16")).toContainText("Superseded");
  await expect(page.getByTestId("rollback-modes-lines-2026-10-16")).toBeVisible();
  await expect(page.getByTestId("create-draft")).toBeEnabled();
});

test("coverage lists the barangays on file", async ({ page, context }) => {
  await signInAs(context, "commuter,admin");
  await mockAdminApi(page);
  await page.goto("/admin/coverage");
  await expect(page.getByTestId("coverage-table")).toContainText("Bagumbayan Norte");
  await expect(page.getByTestId("coverage-table")).toContainText("Not stated");
  await axe(page, "coverage");
});

for (const scheme of ["light", "dark"] as const) {
  test(`revisions with a validation report pass axe (${scheme})`, async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signInAs(context, "commuter,admin");
    await mockAdminApi(page);
    await page.goto("/admin/revisions");
    await page.getByTestId("validate-draft-2026-10-22-100000").click();
    await expect(page.getByTestId("validation-report")).toBeVisible();
    await page.getByTestId("publish-draft-2026-10-22-100000").click();
    await page.getByTestId("confirm-publication-go").click();
    await expect(page.getByTestId("admin-step-up")).toBeVisible();
    await axe(page, `revisions-${scheme}`);
    await page.goto("/admin");
    await expect(page.getByTestId("published-label")).toBeVisible();
    await axe(page, `dashboard-${scheme}`);
  });
}
