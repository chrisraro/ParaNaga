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
const TRANSIT_PATHS = ["/admin/revisions", "/admin/coverage", "/admin/imports", "/admin/candidates", "/admin/stops", "/admin/reconciliation"];
const SYSTEM_PATHS = ["/admin/users", "/admin/providers", "/admin/jobs", "/admin/audit"];
const ADMIN_PATHS = ["/admin", ...TRANSIT_PATHS, "/admin/corrections", "/admin/moderation", "/admin/complaints", ...SYSTEM_PATHS];

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
  for (const path of ADMIN_PATHS) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
  }
  const adminCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/admin")) adminCalls.push(r.url());
  });
  for (const roles of ["commuter", "commuter,contributor"]) {
    await context.clearCookies();
    await signInAs(context, roles);
    for (const path of ADMIN_PATHS) {
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
  await expect(page.getByTestId("admin-nav").getByRole("link")).toHaveText([
    "Dashboard",
    "Imports",
    "Candidate review",
    "Stops & curbs",
    "Reconciliation",
    "Revisions & publication",
    "Coverage audit",
    "Corrections review",
    "Moderation & appeals",
    "Users & roles",
    "Jev & providers",
    "Jobs",
    "Audit log",
  ]);
  await expect(page.getByTestId("card-moderation")).toBeVisible();
  await expect(page.getByTestId("card-complaints")).toHaveCount(0); // admins are not complaint reviewers
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

// ================================================================ N5b: candidates, stops, reconciliation, imports
// The same approach: the shell from the roles cookie, every /api/v1/admin/** call answered here
// with the production headers. The mock keeps the stops' state and mirrors the database's rules
// (version check, evidence of the claimed kind, curb evidence, no retiring a stop in a stop order),
// so the screens are driven through the AC-8 steps: review a candidate, attach evidence, promote,
// relocate, retire. tests/unit/admin-stops-handlers.test.ts and the integration test cover the real checks.

const ID = (n: number) => `7a2c1c7e-6f0a-4a39-9d62-0d0f5f2a8${String(n).padStart(3, "0")}`;

type MockStop = {
  stopPointId: string; versionId: string; name: string; aliases: string[]; status: string; layer: string; code: string; labelRaw: string;
  lat: number; lng: number; curbSide: string | null; boardingAllowed: boolean | null; alightingAllowed: boolean | null; navigationApproved: boolean;
  editNote: string | null; isSynthetic: boolean; sequences: string[];
  pins: { layer: string; code: string; label: string; description: string; lat: number; lng: number }[];
  evidence: { id: string; kind: string; claim: string; note: string | null; observedOn: string | null; sourceCode: string | null; hasMedia: boolean; createdAt: string }[];
};

function mockStop(n: number, layer: string, code: string, name: string, lat: number, lng: number, over: Partial<MockStop> = {}): MockStop {
  return {
    stopPointId: ID(n), versionId: ID(n + 500), name, aliases: [], status: "candidate", layer: `Loop Service ${layer}`, code, labelRaw: name,
    lat, lng, curbSide: null, boardingAllowed: null, alightingAllowed: null, navigationApproved: false, editNote: null, isSynthetic: false,
    sequences: [], pins: [{ layer: `Loop Service ${layer}`, code, label: name, description: name, lat, lng }], evidence: [], ...over,
  };
}

const REQUIRED: Record<string, string[]> = { documentary: ["legal_designation"], installed: ["sign_installed"], field_verified: ["operating_observed", "curb_position"] };

async function mockStopsApi(page: Page) {
  const s = {
    version: 900,
    stops: [
      mockStop(1, "A", "A1", "Plaza Rizal", 13.6233869, 123.1846726, { sequences: ["R8-A"] }),
      mockStop(2, "C", "C5", "Naga Cathedral", 13.6261, 123.1897),
      mockStop(3, "C", "A1", "Plaza Rizal", 13.6233869, 123.1846726),
    ],
    actions: [] as Record<string, unknown>[],
    decisions: [] as Record<string, unknown>[],
    pairOpen: true,
    commits: [] as unknown[],
  };
  const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", headers: PRIVATE, body: JSON.stringify(body) });
  const err = (status: number, code: string, message: string) => json({ error: { code, message, requestId: "e2e" } }, status);
  const draft = { id: DRAFT, label: "draft-2026-10-22-100000", kind: "provisional", status: "draft" };
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (r) => r.abort());
  await routeNetwork(page);
  await page.route("**/api/v1/admin/stops", (r) => r.fulfill(json({ revision: draft, editable: true, stops: s.stops })));
  await page.route(/\/api\/v1\/admin\/stops\/[^/]+$/, (r) => {
    const id = r.request().url().split("/").at(-1)!;
    const body = r.request().postDataJSON() as Record<string, unknown> & { action: string; expectedVersionId: string };
    s.actions.push({ id, ...body });
    const stop = s.stops.find((x) => x.stopPointId === id);
    if (!stop) return r.fulfill(err(404, "not_found", "No such stop in the open draft."));
    if (stop.versionId !== body.expectedVersionId) return r.fulfill(err(409, "conflict", "This stop changed since the page was loaded; reload and try again."));
    const claims = new Set(stop.evidence.map((e) => e.claim));
    switch (body.action) {
      case "evidence":
        stop.evidence.push({ id: ID(s.version - 600), kind: String(body.kind), claim: String(body.claim), note: (body.note as string) ?? null, observedOn: null, sourceCode: (body.sourceCode as string) ?? null, hasMedia: false, createdAt: "2026-10-22T02:10:00.000Z" });
        break;
      case "promote":
        if (!REQUIRED[String(body.status)]!.some((c) => claims.has(c))) return r.fulfill(err(409, "conflict", `Promotion to ${body.status} needs evidence first.`));
        stop.status = String(body.status);
        break;
      case "relocate":
        stop.lat = Number(body.lat);
        stop.lng = Number(body.lng);
        stop.editNote = String(body.reason);
        stop.evidence = stop.evidence.filter((e) => e.claim !== "curb_position");
        break;
      case "retire":
        if (stop.sequences.length) return r.fulfill(err(409, "conflict", `The stop is in the stop order of ${stop.sequences.join(", ")}.`));
        stop.status = "retired";
        break;
      case "edit": {
        const c = body.changes as Record<string, unknown>;
        if (("curbSide" in c || "curbLat" in c) && !claims.has("curb_position")) return r.fulfill(err(409, "conflict", "Curb side and curb point need curb position evidence on this stop first."));
        if (typeof c.name === "string") stop.name = c.name;
        if (Array.isArray(c.aliases)) stop.aliases = c.aliases as string[];
        if ("curbSide" in c) stop.curbSide = c.curbSide as string | null;
        break;
      }
    }
    s.version += 1;
    stop.versionId = ID(s.version);
    return r.fulfill(json({ stopPointId: id, versionId: stop.versionId }));
  });
  await page.route("**/api/v1/admin/reconciliation", (r) => {
    if (r.request().method() === "POST") {
      const body = r.request().postDataJSON() as Record<string, unknown>;
      s.decisions.push(body);
      s.pairOpen = false;
      return r.fulfill(json({ decision: body.decision, keptVersionId: null, retiredVersionId: null }));
    }
    const [a, , c] = s.stops;
    return r.fulfill(
      json({
        revision: draft,
        editable: true,
        pairs: s.pairOpen
          ? [{
              a: { stopPointId: a!.stopPointId, versionId: a!.versionId, name: a!.name, status: a!.status, layer: a!.layer, code: a!.code, lat: a!.lat, lng: a!.lng },
              b: { stopPointId: c!.stopPointId, versionId: c!.versionId, name: c!.name, status: c!.status, layer: c!.layer, code: c!.code, lat: c!.lat, lng: c!.lng },
              distanceM: 0,
              similarNames: true,
            }]
          : [],
        mismatches: [{ stopPointId: ID(2), name: "Naga Cathedral", status: "candidate", pinLayer: "Loop Service C", pinCode: "C5", pinLabel: "Metropolitan Cathedral", distanceM: 22.4, far: true, nameDiffers: true }],
        decisions: s.pairOpen
          ? []
          : [{ id: ID(990), decision: "keep_separate", distanceM: 0, a: "Plaza Rizal", b: "Plaza Rizal", kept: null, note: null, decidedAt: "2026-10-22T02:20:00.000Z" }],
      }),
    );
  });
  const BASE_BATCH = ID(800);
  await page.route("**/api/v1/admin/imports", (r) =>
    r.fulfill(
      json({
        baseline: { batchId: BASE_BATCH, snapshotVersion: "mymaps:naga:2026-10-15", mapId: "naga", finishedAt: "2026-10-15T01:02:00.000Z" },
        batches: [{ id: BASE_BATCH, snapshotVersion: "mymaps:naga:2026-10-15", mode: "commit", status: "committed", startedBy: "import", startedAt: "2026-10-15T01:00:00.000Z", finishedAt: "2026-10-15T01:02:00.000Z", fileName: "naga_mapped_stops_source.kml", changes: { added: 128, changed: 0, unchanged: 0, missing: 0 }, conflicts: 134 }],
      }),
    ),
  );
  await page.route("**/api/v1/admin/imports/dry-run", (r) => {
    const body = r.request().postDataJSON() as { text: string; retrievedOn: string; fileName: string };
    const bad = body.text.includes("BROKEN");
    return r.fulfill(
      json({
        snapshotVersion: `mymaps:naga:${body.retrievedOn}`, mapId: "naga", fileName: body.fileName, sha256: "c".repeat(64), bytes: body.text.length,
        baseline: { batchId: BASE_BATCH, snapshotVersion: "mymaps:naga:2026-10-15" },
        counts: { total: bad ? 127 : 128, byLayer: { A: 30, B: 31, C: 34, D: bad ? 32 : 33 }, expectedTotal: 128, expectedByLayer: { A: 30, B: 31, C: 34, D: 33 } },
        changes: { added: 0, changed: bad ? 0 : 1, unchanged: 127, missing: bad ? 1 : 0 },
        rows: bad ? [{ kind: "missing", layer: "Loop Service D", code: "D33", label: "Old pin", fromLabel: null, movedM: null }] : [{ kind: "changed", layer: "Loop Service A", code: "A1", label: "Plaza Rizal", fromLabel: null, movedM: 111.2 }],
        conflicts: [{ kind: "exact_coordinate_shared", meters: null, records: [{ layer: "Loop Service A", code: "A1", label: "Plaza Rizal" }, { layer: "Loop Service C", code: "A1", label: "Plaza Rizal" }] }],
        problems: bad ? ["The file has 127 pins; 128 are expected.", "Layer D has 32 pins; 33 are expected."] : [],
        canCommit: !bad,
      }),
    );
  });
  await page.route("**/api/v1/admin/imports/commit", (r) => {
    s.commits.push(r.request().postDataJSON());
    return r.fulfill(json({ outcome: "committed", batchId: ID(801), snapshotVersion: "mymaps:naga:2026-10-20", revisionId: DRAFT, counts: { added: 0, changed: 1, unchanged: 127, missing: 0, new_candidate_stops: 0, new_stop_versions: 1 } }, 201));
  });
  return s;
}

test("candidate review: evidence, promote, relocate and retire in the draft (AC-8 admin steps)", async ({ page, context }) => {
  await signInAs(context, "commuter,transport_reviewer");
  const s = await mockStopsApi(page);
  await page.goto("/admin/candidates");
  await expect(page).toHaveTitle("Candidate review · Admin · ParaNaga");
  await expect(page.getByTestId("stops-table")).toContainText("3 of 3 stops in draft-2026-10-22-100000");

  // A stop in a route's stop order cannot be retired from here.
  await page.getByTestId("stop-Loop Service A-A1").getByRole("button", { name: /Review/ }).click();
  await expect(page.getByTestId("retire-form")).toContainText("In the stop order of R8-A");
  await expect(page.getByTestId("retire-go")).toBeDisabled();

  await page.getByTestId("stop-Loop Service C-C5").getByRole("button", { name: /Review/ }).click();
  await expect(page.getByTestId("stop-panel")).toContainText("Naga Cathedral");
  // Promotion needs evidence of the claimed kind first.
  await expect(page.getByTestId("promote-form")).toContainText("Needs evidence for legal designation.");
  await expect(page.getByTestId("promote-go")).toBeDisabled();

  await page.getByTestId("evidence-source").fill("S12");
  await page.getByTestId("evidence-note").fill("Ordinance list names the cathedral stop.");
  await page.getByTestId("evidence-go").click();
  await expect(page.getByTestId("stops-notice")).toContainText("Evidence for legal designation attached to C5.");
  await expect(page.getByTestId("stop-evidence")).toContainText("legal designation");

  await expect(page.getByTestId("promote-go")).toBeEnabled();
  await page.getByTestId("promote-go").click();
  await expect(page.getByTestId("stops-notice")).toContainText("C5 is now documentary.");
  await expect(page.getByTestId("stop-status")).toHaveText("documentary");

  await page.getByTestId("relocate-lat").fill("13.6263");
  await page.getByTestId("relocate-reason").fill("Pin sat in the plaza; the stop is at the curb.");
  await page.getByTestId("relocate-go").click();
  await expect(page.getByTestId("stops-notice")).toContainText("C5 moved.");
  await expect(page.getByTestId("stop-position")).toHaveText("13.626300, 123.189700");

  await page.getByTestId("retire-reason").fill("Duplicate of the cathedral stop on Loop A.");
  await page.getByTestId("retire-go").click();
  await expect(page.getByTestId("stops-notice")).toContainText("C5 retired.");
  await expect(page.getByTestId("stop-status")).toHaveText("retired");

  // Every action sent the version the page was showing (optimistic concurrency).
  const c5 = s.actions.filter((a) => a.id === ID(2));
  expect(c5.map((a) => a.action)).toEqual(["evidence", "promote", "relocate", "retire"]);
  expect(c5[0]!.expectedVersionId).toBe(ID(502));
  expect(new Set(c5.map((a) => a.expectedVersionId)).size).toBe(4);
  expect(c5[0]).toMatchObject({ kind: "document", claim: "legal_designation", sourceCode: "S12" });
});

test("stops and curbs: curb side waits for curb evidence; edits go to the draft", async ({ page, context }) => {
  await signInAs(context, "commuter,admin");
  const s = await mockStopsApi(page);
  await page.goto("/admin/stops");
  await page.getByTestId("stop-Loop Service C-C5").getByRole("button", { name: /Edit/ }).click();
  await expect(page.getByTestId("edit-curb-side")).toBeDisabled();
  await page.getByTestId("evidence-kind").selectOption("field_survey");
  await page.getByTestId("evidence-claim").selectOption("curb_position");
  await page.getByTestId("evidence-note").fill("Surveyed 2026-10-20: northbound curb, shelter.");
  await page.getByTestId("evidence-go").click();
  await expect(page.getByTestId("stops-notice")).toContainText("curb position");
  await expect(page.getByTestId("edit-curb-side")).toBeEnabled();
  await page.getByTestId("edit-name").fill("Naga Metropolitan Cathedral");
  await page.getByTestId("edit-aliases").fill("Cathedral, Katedral");
  await page.getByTestId("edit-curb-side").selectOption("right_of_travel");
  await page.getByTestId("edit-go").click();
  await expect(page.getByTestId("stops-notice")).toContainText("updated");
  await expect(page.getByTestId("stop-panel")).toContainText("Naga Metropolitan Cathedral");
  expect(s.actions.at(-1)).toMatchObject({ action: "edit", changes: { name: "Naga Metropolitan Cathedral", aliases: ["Cathedral", "Katedral"], curbSide: "right_of_travel" } });
});

test("reconciliation: decide a same-point pair; pin mismatches are listed read-only", async ({ page, context }) => {
  await signInAs(context, "commuter,transport_reviewer");
  const s = await mockStopsApi(page);
  await page.goto("/admin/reconciliation");
  await expect(page.getByTestId("pairs-table")).toContainText("Same point");
  await expect(page.getByTestId("mismatches-table")).toContainText("Metropolitan Cathedral");
  await page.getByTestId("pair-open-A1-A1").click();
  await page.getByTestId("pair-go-A1-A1").click();
  await expect(page.getByTestId("reconcile-notice")).toContainText("separate");
  await expect(page.getByTestId("pairs")).toContainText("Nothing to decide.");
  await expect(page.getByTestId("decisions")).toContainText("kept separate");
  expect(s.decisions).toEqual([{ a: { stopPointId: ID(1), expectedVersionId: ID(501) }, b: { stopPointId: ID(3), expectedVersionId: ID(503) }, decision: "keep_separate" }]);
});

test("imports: dry run shows the diff, counts and conflicts; a count mismatch blocks commit; commit goes to the draft", async ({ page, context }) => {
  await signInAs(context, "commuter,admin");
  const s = await mockStopsApi(page);
  await page.goto("/admin/imports");
  await expect(page.getByTestId("import-baseline")).toContainText("mymaps:naga:2026-10-15");
  await expect(page.getByTestId("import-batches")).toContainText("naga_mapped_stops_source.kml");

  await page.getByTestId("import-file").setInputFiles({ name: "naga-broken.kml", mimeType: "application/vnd.google-earth.kml+xml", buffer: Buffer.from("<kml>BROKEN</kml>") });
  await page.getByTestId("import-date").fill("2026-10-20");
  await page.getByTestId("import-dry-run").click();
  await expect(page.getByTestId("import-problems")).toContainText("Layer D has 32 pins; 33 are expected.");
  await expect(page.getByTestId("import-commit")).toBeDisabled();

  await page.getByTestId("import-file").setInputFiles({ name: "naga.kml", mimeType: "application/vnd.google-earth.kml+xml", buffer: Buffer.from("<kml>ok</kml>") });
  await page.getByTestId("import-date").fill("2026-10-20");
  await page.getByTestId("import-dry-run").click();
  await expect(page.getByTestId("import-changes")).toContainText("1 changed");
  await expect(page.getByTestId("import-changes")).toContainText("127 unchanged");
  await expect(page.getByTestId("import-rows")).toContainText("111.2 m");
  await expect(page.getByTestId("import-conflicts")).toContainText("exact coordinate shared");
  await expect(page.getByTestId("import-counts")).toContainText("128");
  await page.getByTestId("import-commit").click();
  await expect(page.getByTestId("import-commit-result")).toContainText("Committed mymaps:naga:2026-10-20: 0 added, 1 changed, 127 unchanged, 0 missing.");
  expect(s.commits).toEqual([{ format: "kml", fileName: "naga.kml", text: "<kml>ok</kml>", retrievedOn: "2026-10-20", expectedBaselineBatchId: ID(800) }]);
});

for (const scheme of ["light", "dark"] as const) {
  test(`candidates, stops, reconciliation and imports pass axe (${scheme})`, async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signInAs(context, "commuter,admin");
    await mockStopsApi(page);
    await page.goto("/admin/candidates");
    await page.getByTestId("stop-Loop Service C-C5").getByRole("button", { name: /Review/ }).click();
    await expect(page.getByTestId("promote-form")).toBeVisible();
    await axe(page, `candidates-${scheme}`);
    await page.goto("/admin/stops");
    await page.getByTestId("stop-Loop Service A-A1").getByRole("button", { name: /Edit/ }).click();
    await expect(page.getByTestId("edit-form")).toBeVisible();
    await axe(page, `stops-${scheme}`);
    await page.goto("/admin/reconciliation");
    await page.getByTestId("pair-open-A1-A1").click();
    await axe(page, `reconciliation-${scheme}`);
    await page.goto("/admin/imports");
    await page.getByTestId("import-file").setInputFiles({ name: "naga-broken.kml", mimeType: "application/vnd.google-earth.kml+xml", buffer: Buffer.from("<kml>BROKEN</kml>") });
    await page.getByTestId("import-date").fill("2026-10-20");
    await page.getByTestId("import-dry-run").click();
    await expect(page.getByTestId("import-dry")).toBeVisible();
    await axe(page, `imports-${scheme}`);
  });
}

// ================================================================ N6: corrections review (C9), moderation and appeals (C10)
// Same approach: the shell from the roles cookie, every /api/v1/admin/** call answered here with the
// production headers, the mock keeping the queue's state. tests/unit/admin-review-handlers.test.ts
// and tests/integration/review-moderation-rls.test.ts cover the real checks (roles, own content,
// draft-only accept, override notes, appeals routed to a different moderator).

const N6 = (n: number) => `7b3c1c7e-6f0a-4a39-9d62-0d0f5f2a8${String(n).padStart(3, "0")}`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function correctionRow(over: Record<string, unknown>) {
  return {
    id: N6(1), kind: "stop_moved_removed", entityType: "stop", entityId: N6(10), entityLabel: "Plaza Rizal", entityRevisionId: null,
    description: "The stop sign is now across the street, by the bakery.", status: "submitted", submittedAt: "2026-10-22T02:00:00.000Z",
    updatedAt: "2026-10-22T02:00:00.000Z", moderationReason: "auto_publish_disabled", reviewerNote: null, duplicateOf: null,
    draftRevisionId: null, draftChange: null, incorporatedRevisionId: null, reviewedAt: null,
    location: { lat: 13.62355, lng: 123.18485, accuracyM: 6 }, media: [{ id: N6(20), mime: "image/png" }],
    events: [{ from: "draft", to: "submitted", at: "2026-10-22T02:00:00.000Z", actorRole: "commuter", reasonCode: "auto_publish_disabled", note: null }],
    similar: [],
    stop: { stopPointId: N6(10), name: "Plaza Rizal", versionId: N6(11), status: "candidate", inDraft: true, changedInDraft: false, lat: 13.6233869, lng: 123.1846726 },
    fares: null,
    ...over,
  };
}

async function mockReviewApi(page: Page) {
  const s = {
    corrections: [
      correctionRow({}),
      correctionRow({
        id: N6(2), kind: "fare_mismatch", entityType: "fare", entityId: "R4", entityLabel: "Route 4", status: "under_review",
        description: "The driver charged 15 pesos for a short ride.", location: null, media: [], stop: null,
        fares: [{ fareRuleId: N6(30), code: "F01", modeCode: "jeepney", versionId: N6(31), baseCentavos: 1300, status: "draft", effectiveFrom: null, sourceCodes: ["S12"], evidence: [], openConflicts: 1 }],
      }),
    ] as Record<string, unknown>[],
    reviews: [] as { id: string; body: unknown }[],
    decisions: [] as unknown[],
    appeals: [] as { id: string; body: unknown }[],
    mediaReads: 0,
  };
  const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", headers: PRIVATE, body: JSON.stringify(body) });
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (r) => r.abort());
  await routeNetwork(page);
  await page.route(/\/api\/v1\/admin\/corrections(\?.*)?$/, (r) => r.fulfill(json({ draft: { id: DRAFT, label: "draft-2026-10-22-100000" }, corrections: s.corrections })));
  await page.route(/\/api\/v1\/admin\/corrections\/[^/?]+$/, (r) => {
    const id = r.request().url().split("/").at(-1)!;
    const body = r.request().postDataJSON() as { action: string; change?: { kind: string } };
    s.reviews.push({ id, body });
    const row = s.corrections.find((c) => c.id === id)!;
    const to = { start_review: "under_review", request_info: "needs_evidence", reject: "rejected", duplicate: "duplicate", accept: "accepted" }[body.action]!;
    row.status = to;
    const draftChange = body.action === "accept" ? (body.change?.kind === "proposal" ? { kind: "proposal" } : { kind: "draft_version", entityKind: "stop_point", entityId: N6(10), versionId: N6(12) }) : null;
    return r.fulfill(json({ id, status: to, draftRevisionId: body.action === "accept" ? DRAFT : null, draftChange }));
  });
  await page.route(/\/api\/v1\/admin\/media\/[^/]+$/, (r) => {
    s.mediaReads += 1;
    return r.fulfill({ status: 200, contentType: "image/png", headers: PRIVATE, body: PNG });
  });
  await page.route("**/api/v1/admin/moderation", (r) =>
    r.fulfill(
      json({
        items: [
          {
            kind: "post_version", id: N6(40), postId: N6(41), status: "pending", submittedAt: "2026-10-22T02:00:00.000Z", title: "R4 before 7 am",
            body: "The jeepneys wait at the plaza for five minutes.", tags: ["r4"], topic: "commute_tips", authorHandle: "Commuter AB12C",
            reason: "auto_publish_disabled", isEdit: false, liveTitle: null, jev: { recommendation: "publish", confidence: 0.93, unavailableReason: null, policyVersion: "paranaga-community-v1" }, openReports: 0,
          },
          {
            kind: "photo", id: N6(42), postId: N6(41), status: "pending", submittedAt: "2026-10-22T02:01:00.000Z", title: "R4 before 7 am",
            body: null, tags: [], topic: null, authorHandle: "Commuter AB12C", reason: null, isEdit: false, liveTitle: null, jev: null, openReports: 0, mediaId: N6(43),
          },
        ],
        appeals: [
          {
            id: N6(50), decisionId: N6(51), targetType: "post_version", targetId: N6(52), reasonCode: "threat", decidedAt: "2026-10-21T02:00:00.000Z",
            decidedBy: "policy", jevRecommendation: "reject", jevConfidence: 0.96, note: "This is criticism of the fare increase, not a threat.",
            createdAt: "2026-10-22T01:00:00.000Z", excerpt: "Fare increase: this is robbery and the officials should resign.", mediaId: null,
          },
        ],
        history: [{ id: N6(60), targetType: "comment", targetId: N6(61), outcome: "rejected", reasonCode: "spam", deciderRole: "community_moderator", isOverride: false, mine: false, appealed: false, at: "2026-10-21T03:00:00.000Z" }],
      }),
    ),
  );
  await page.route("**/api/v1/admin/moderation/decisions", (r) => {
    const body = r.request().postDataJSON() as { outcome: string; targetType: string };
    s.decisions.push(body);
    return r.fulfill(json({ decisionId: N6(70), isOverride: body.targetType === "post_version" && body.outcome === "rejected" }));
  });
  await page.route(/\/api\/v1\/admin\/moderation\/appeals\/[^/]+$/, (r) => {
    s.appeals.push({ id: r.request().url().split("/").at(-1)!, body: r.request().postDataJSON() });
    return r.fulfill(json({ decisionId: N6(71), isOverride: true }));
  });
  return s;
}

test("a moderator sees only the moderation screens; transport staff never see moderation", async ({ page, context }) => {
  await signInAs(context, "commuter,community_moderator");
  const s = await mockReviewApi(page);
  const adminCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/admin/dashboard")) adminCalls.push(r.url());
  });
  await page.goto("/admin");
  await expect(page.getByTestId("admin-nav").getByRole("link")).toHaveText(["Dashboard", "Moderation & appeals", "Jev & providers", "Audit log"]);
  await expect(page.getByTestId("card-moderation")).toBeVisible();
  await expect(page.getByTestId("card-published")).toHaveCount(0);
  for (const path of [...TRANSIT_PATHS, "/admin/corrections", "/admin/complaints", "/admin/users", "/admin/jobs"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }), path).toHaveText("Wrong stop.");
  }
  expect(adminCalls).toEqual([]);
  expect(s.reviews).toEqual([]);

  await context.clearCookies();
  await signInAs(context, "commuter,transport_reviewer");
  await page.goto("/admin/moderation");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wrong stop.");
});

test("corrections review: evidence, start review, accept a stop report as a relocation in the draft, a fare report as a traced proposal", async ({ page, context }) => {
  await signInAs(context, "commuter,transport_reviewer");
  const s = await mockReviewApi(page);
  await page.goto("/admin/corrections");
  await expect(page).toHaveTitle("Corrections review · Admin · ParaNaga");
  await expect(page.getByTestId("admin-corrections")).toContainText("open draft draft-2026-10-22-100000");

  await page.getByTestId(`correction-open-${N6(1)}`).click();
  const detail = page.getByTestId("correction-detail");
  await expect(detail).toContainText("The stop sign is now across the street");
  await expect(detail.getByRole("img", { name: "Evidence photo 1" })).toBeVisible();
  expect(s.mediaReads).toBe(1);
  await page.getByTestId("correction-submit").click(); // Start review is the first action
  await expect(page.getByTestId("correction-notice")).toContainText("Moved to under review");
  expect(s.reviews.at(-1)).toEqual({ id: N6(1), body: { action: "start_review", expectedStatus: "submitted" } });

  await page.getByTestId(`correction-open-${N6(1)}`).click();
  await page.getByLabel("Move the stop to the reported location (new stop version in the draft)").check();
  await page.getByTestId("correction-note").fill("Matches the photo.");
  await page.getByTestId("correction-submit").click();
  await expect(page.getByTestId("correction-notice")).toContainText("Accepted into the draft. Nothing is public until the draft is validated and published.");
  expect(s.reviews.at(-1)!.body).toEqual({
    action: "accept",
    expectedStatus: "under_review",
    note: "Matches the photo.",
    change: {
      kind: "stop_action",
      stopPointId: N6(10),
      stopAction: { action: "relocate", expectedVersionId: N6(11), lat: 13.62355, lng: 123.18485, reason: `Commuter correction ${N6(1).slice(0, 8)}: Matches the photo.` },
    },
  });

  await page.getByTestId(`correction-open-${N6(2)}`).click();
  await expect(page.getByTestId("fare-trace")).toContainText("F01 (jeepney)");
  await expect(page.getByTestId("fare-trace")).toContainText("₱13.00");
  await page.getByTestId("correction-submit").click(); // accept, proposal: refused without a note
  await expect(page.getByTestId("correction-detail")).toContainText("A proposal needs a note");
  await page.getByLabel("Fare rule this is about (optional, recorded for tracing)").selectOption(N6(31));
  await page.getByTestId("correction-note").fill("Charged ₱15; check the matrix.");
  await page.getByTestId("correction-submit").click();
  await expect(page.getByTestId("correction-notice")).toContainText("as a proposal");
  expect(s.reviews.at(-1)!.body).toEqual({ action: "accept", expectedStatus: "under_review", note: "Charged ₱15; check the matrix.", change: { kind: "proposal" }, fareRuleVersionId: N6(31) });
});

test("moderation: an override of Jev needs a note; approving a photo makes it public; an appeal of a policy decision is decided with a note", async ({ page, context }) => {
  await signInAs(context, "commuter,community_moderator");
  const s = await mockReviewApi(page);
  await page.goto("/admin/moderation");
  const post = page.getByTestId(`item-post_version-${N6(40)}`);
  await expect(post).toContainText("Jev: publish at 93%");
  await post.getByLabel("Do not publish").check();
  await expect(page.getByTestId(`override-post_version-${N6(40)}`)).toBeVisible();
  await page.getByTestId(`decide-post_version-${N6(40)}`).click();
  await expect(post).toContainText("needs a note");
  expect(s.decisions).toEqual([]);
  await page.getByTestId(`reason-post_version-${N6(40)}`).selectOption("personal_info");
  await page.getByTestId(`note-post_version-${N6(40)}`).fill("Names a private person.");
  await page.getByTestId(`decide-post_version-${N6(40)}`).click();
  await expect(page.getByTestId("moderation-notice")).toContainText("Post not published (override of Jev, recorded).");
  expect(s.decisions.at(-1)).toEqual({ targetType: "post_version", targetId: N6(40), outcome: "rejected", reason: "personal_info", note: "Names a private person." });

  const photo = page.getByTestId(`item-photo-${N6(42)}`);
  await expect(photo.getByRole("img")).toBeVisible();
  await expect(photo).toContainText("Photos are never sent to Jev.");
  await page.getByTestId(`decide-photo-${N6(42)}`).click();
  expect(s.decisions.at(-1)).toEqual({ targetType: "photo", targetId: N6(42), outcome: "published", reason: "meets_guidelines" });

  const appeal = page.getByTestId(`appeal-${N6(50)}`);
  await expect(appeal).toContainText("the policy (Jev, high certainty)");
  await appeal.getByLabel("Overturn: publish it").check();
  await expect(appeal).toContainText("recorded as an override");
  await page.getByTestId(`appeal-note-${N6(50)}`).fill("Criticism of a policy, not a threat.");
  await page.getByTestId(`appeal-go-${N6(50)}`).click();
  await expect(page.getByTestId("moderation-notice")).toContainText("Appeal accepted: now published (override of Jev, recorded).");
  expect(s.appeals).toEqual([{ id: N6(50), body: { outcome: "overturned", note: "Criticism of a policy, not a threat." } }]);
});

for (const scheme of ["light", "dark"] as const) {
  test(`corrections review and moderation pass axe (${scheme})`, async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signInAs(context, "commuter,admin");
    await mockReviewApi(page);
    await page.goto("/admin/corrections");
    await page.getByTestId(`correction-open-${N6(2)}`).click();
    await expect(page.getByTestId("fare-trace")).toBeVisible();
    await axe(page, `corrections-${scheme}`);
    await page.goto("/admin/moderation");
    await page.getByTestId(`item-post_version-${N6(40)}`).getByLabel("Do not publish").check();
    await expect(page.getByTestId(`override-post_version-${N6(40)}`)).toBeVisible();
    await axe(page, `moderation-${scheme}`);
  });
}

// ================================================================ N7: complaint review (C11), users, providers, jobs, audit (C12)
// Same approach. The mock refuses every complaint call with 403 step_up_required until the step-up
// code is checked, like the server. tests/unit/admin-complaint-handlers.test.ts,
// tests/unit/admin-system-handlers.test.ts and tests/integration/complaint-review-system-rls.test.ts
// cover the real checks (role only, no admins, step-up in the same transaction, own reports
// hidden, audit, retention, role safeguards).

const N7 = (n: number) => `7c4c1c7e-6f0a-4a39-9d62-0d0f5f2a8${String(n).padStart(3, "0")}`;
const SIGNED = "https://storage.example/evidence-private/complaint_evidence/e2e.jpg?X-Amz-Expires=60&response-content-disposition=attachment";

async function mockN7Api(page: Page) {
  const s = { verified: false, actions: [] as unknown[], links: 0, roleChanges: [] as unknown[], diagnostics: 0, auditQueries: [] as string[] };
  const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", headers: PRIVATE, body: JSON.stringify(body) });
  const err = (status: number, code: string, message: string) => json({ error: { code, message, requestId: "e2e" } }, status);
  const stepUp = () => err(403, "step_up_required", "Enter a new code from your email to continue.");
  await page.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (r) => r.abort());
  await routeNetwork(page);
  await page.route("https://storage.example/**", (r) => r.fulfill({ status: 200, contentType: "image/jpeg", headers: { "content-disposition": "attachment" }, body: PNG }));
  const list = [
    { id: N7(1), publicRef: "PN-7KQ4-2M", category: "harassment", status: "submitted", queue: "queue_priority", submittedAt: "2026-10-22T02:00:00.000Z", incidentAt: "2026-10-22T01:00:00.000Z", updatedAt: "2026-10-22T02:00:00.000Z", closedAt: null, outcomeCode: null, legalHold: false, evidenceCount: 1 },
    { id: N7(2), publicRef: "PN-9WXR-4T", category: "overcharging", status: "under_review", queue: "queue_normal", submittedAt: "2026-10-21T02:00:00.000Z", incidentAt: "2026-10-21T01:00:00.000Z", updatedAt: "2026-10-21T03:00:00.000Z", closedAt: null, outcomeCode: null, legalHold: true, evidenceCount: 0 },
  ];
  const detail = {
    ...list[0], description: "The driver shouted at me and refused to give change.", retentionUntil: null, operator: "Fixture Transport Coop", plate: "ABC 1234", bodyNumber: "17",
    location: { source: "gps", text: null, accuracyM: 12, lat: 13.6234, lng: 123.1847 },
    evidence: [{ id: N7(10), captureKind: "in_app_camera", capturedAt: "2026-10-22T01:00:00.000Z", receivedAt: "2026-10-22T02:00:00.000Z", mime: "image/jpeg", bytes: 204800, sha256: "a".repeat(64), available: true }],
    events: [{ from: null, to: "submitted", actorRole: "reporter", mine: false, visibility: "reporter", outcomeCode: null, note: null, at: "2026-10-22T02:00:00.000Z" }],
    access: [],
  };
  await page.route(/\/api\/v1\/admin\/complaints(\?.*)?$/, (r) => (s.verified ? r.fulfill(json({ scope: new URL(r.request().url()).searchParams.get("scope") ?? "open", complaints: list })) : r.fulfill(stepUp())));
  await page.route(/\/api\/v1\/admin\/complaints\/[^/]+$/, (r) => {
    if (!s.verified) return r.fulfill(stepUp());
    if (r.request().method() === "POST") {
      s.actions.push(r.request().postDataJSON());
      return r.fulfill(json({ ok: true }));
    }
    return r.fulfill(json(detail));
  });
  await page.route(/\/api\/v1\/admin\/complaints\/[^/]+\/evidence\/[^/]+$/, (r) => {
    if (!s.verified) return r.fulfill(stepUp());
    s.links += 1;
    return r.fulfill(json({ url: SIGNED, expiresInSeconds: 60 }));
  });
  await page.route("**/api/v1/me/step-up/code", (r) => r.fulfill(json({ sent: true })));
  await page.route("**/api/v1/me/step-up", (r) => {
    s.verified = true;
    return r.fulfill(json({ verifiedUntil: "2026-10-22T02:20:00.000Z" }));
  });

  const role = (r: string, reason = "test seed") => ({ role: r, active: true, grantedAt: "2026-10-01T00:00:00.000Z", grantedBy: "Owner", revokedAt: null, reason });
  const staff = [
    { userId: "u-me", name: "Me", email: "me@example.com", self: true, suspended: false, roles: [role("commuter"), role("admin", "initial admin bootstrap")] },
    { userId: "u-ana", name: "Ana", email: "ana@example.com", self: false, suspended: false, roles: [role("commuter"), role("transport_reviewer")] },
  ];
  await page.route("**/api/v1/admin/users", (r) => r.fulfill(json({ staff })));
  await page.route("**/api/v1/admin/users/lookup", (r) => {
    const email = (r.request().postDataJSON() as { email: string }).email;
    return r.fulfill(json({ user: email === "ben@example.com" ? { userId: "u-ben", name: "Ben", email, emailVerified: true, hasProfile: true, self: false, suspended: false, roles: [role("commuter")] } : null }));
  });
  await page.route("**/api/v1/admin/users/roles", (r) => {
    if (!s.verified) return r.fulfill(stepUp());
    s.roleChanges.push(r.request().postDataJSON());
    return r.fulfill(json({ ok: true }));
  });
  await page.route("**/api/v1/admin/providers", (r) =>
    r.fulfill(
      json({
        jev: {
          keyPresent: false, enabled: false, modelId: "typesafe/jev-1.13-20260917", modelPinned: true, decisionsHost: "openrouter.ai", policyVersion: "paranaga-community-v1",
          timeoutMs: 10000, dailyBudget: 5000, usedToday: 0, autoPublish: false, complaints: false, health: null,
          whyDisabled: "No OPENROUTER_API_KEY on the server: every post stays pending for a person.",
        },
        providers: [
          { id: "database", label: "Database (paranaga_app)", configured: true, enabled: true, detail: "Runtime connection; row-level security applies." },
          { id: "cron", label: "Cron secret", configured: false, enabled: false, detail: "Protects /api/cron/jobs and /api/cron/retention." },
        ],
        flags: [{ key: "auto_publish", enabled: false, updatedAt: null }],
        canRunDiagnostic: true,
      }),
    ),
  );
  await page.route("**/api/v1/admin/providers/jev-diagnostic", (r) => {
    s.diagnostics += 1;
    return r.fulfill(json({ ran: false, status: "skipped", reason: "x", recommendation: null, confidence: null, ms: null }));
  });
  await page.route("**/api/v1/admin/jobs", (r) =>
    r.fulfill(
      json({
        counts: [{ status: "done", count: 12 }, { status: "dead", count: 1 }],
        jobs: [{ id: N7(30), kind: "moderate_submission", status: "dead", attempts: 5, maxAttempts: 5, runAfter: "2026-10-22T02:00:00.000Z", lastErrorCode: "HANDLER_FAILED", createdAt: "2026-10-22T01:00:00.000Z", finishedAt: "2026-10-22T02:00:00.000Z" }],
        retention: [{ at: "2026-10-22T00:00:00.000Z", dryRun: true, complaints: 2, uploads: 1, objects: 3, failed: 0 }],
      }),
    ),
  );
  await page.route(/\/api\/v1\/admin\/audit(\?.*)?$/, (r) => {
    const u = new URL(r.request().url());
    s.auditQueries.push(u.search);
    const before = u.searchParams.get("before");
    const row = (n: number) => ({ id: N7(100 + n), at: "2026-10-22T02:00:00.000Z", actorUserId: "u-me", actorName: "Me", actorRole: "admin", action: "role.grant", entityType: "user", entityId: "u-ana", after: { role: "transport_reviewer", reason: "Field lead" }, requestId: `req-${n}` });
    return r.fulfill(json({ scope: "all", rows: before ? [row(2)] : [row(1)], next: before ? null : `1792634400123456|${N7(101)}` }));
  });
  return s;
}

test("complaint reviewers: their own nav only; admins, moderators and transport staff never reach complaint review", async ({ page, context }) => {
  await signInAs(context, "commuter,complaint_reviewer");
  const s = await mockN7Api(page);
  await page.goto("/admin");
  await expect(page.getByTestId("admin-nav").getByRole("link")).toHaveText(["Dashboard", "Complaint review", "Audit log"]);
  await expect(page.getByTestId("card-complaints")).toBeVisible();
  for (const path of [...TRANSIT_PATHS, "/admin/corrections", "/admin/moderation", "/admin/users", "/admin/providers", "/admin/jobs"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }), path).toHaveText("Wrong stop.");
  }
  for (const roles of ["commuter,admin", "commuter,community_moderator", "commuter,transport_reviewer"]) {
    await context.clearCookies();
    await signInAs(context, roles);
    await page.goto("/admin/complaints");
    await expect(page.getByRole("heading", { level: 1 }), roles).toHaveText("Wrong stop.");
  }
  expect(s.links).toBe(0);
});

test("complaint review: step-up first, list without text, open, a 60-second download, a neutral close", async ({ page, context }) => {
  await signInAs(context, "commuter,complaint_reviewer");
  const s = await mockN7Api(page);
  await page.goto("/admin/complaints");
  await expect(page).toHaveTitle("Complaint review · Admin · ParaNaga");
  await expect(page.getByTestId("admin-step-up")).toBeVisible();
  await expect(page.getByTestId("complaints-table")).toHaveCount(0);
  await page.getByTestId("admin-step-up-send").click();
  await page.getByTestId("admin-step-up-code").fill("123456");
  await page.getByTestId("admin-step-up-verify").click();

  const table = page.getByTestId("complaints-table");
  await expect(table).toContainText("PN-7KQ4-2M");
  await expect(table).toContainText("Priority");
  await expect(table).toContainText("Legal hold");
  await expect(table).not.toContainText("shouted"); // no text in the list

  await page.getByTestId(`complaint-open-${N7(1)}`).click();
  const detail = page.getByTestId("complaint-detail");
  await expect(page.getByTestId("complaint-description")).toHaveText("The driver shouted at me and refused to give change.");
  await expect(detail).toContainText("Plate ABC 1234");
  await expect(detail.getByRole("img")).toHaveCount(0); // never a preview
  await page.getByTestId(`evidence-download-${N7(10)}`).click();
  await expect(page.getByTestId("evidence-note")).toContainText("works for 60 seconds and this download is logged");
  expect(s.links).toBe(1);
  await expect(page).toHaveURL(/\/admin\/complaints$/);

  await page.getByTestId("complaint-to").selectOption("closed");
  await page.getByTestId("complaint-submit").click();
  await expect(page.getByTestId("complaint-form-error")).toContainText("Choose an outcome");
  await page.getByTestId("complaint-outcome").selectOption("insufficient_detail");
  await page.getByTestId("complaint-note").fill("We could not identify the vehicle.");
  await page.getByTestId("complaint-note-reporter").check();
  await page.getByTestId("complaint-submit").click();
  await expect(page.getByTestId("complaint-notice")).toContainText("PN-7KQ4-2M is now closed.");
  expect(s.actions).toEqual([{ action: "status", to: "closed", outcomeCode: "insufficient_detail", note: "We could not identify the vehicle.", visibility: "reporter" }]);
});

test("users and roles: exact email lookup, a reasoned grant after step-up, no controls on your own row", async ({ page, context }) => {
  await signInAs(context, "commuter,admin");
  const s = await mockN7Api(page);
  await page.goto("/admin/users");
  await expect(page.getByTestId("user-u-me")).toContainText("You cannot change your own roles");
  await expect(page.getByTestId("user-u-me").getByRole("button")).toHaveCount(0);
  await page.getByTestId("users-email").fill("nobody@example.com");
  await page.getByTestId("users-find").click();
  await expect(page.getByTestId("users-lookup")).toContainText("No account uses that address");
  await page.getByTestId("users-email").fill("ben@example.com");
  await page.getByTestId("users-find").click();
  const ben = page.getByTestId("users-lookup").getByTestId("user-u-ben");
  await ben.getByTestId("grant-role-u-ben").selectOption("complaint_reviewer");
  await ben.getByTestId("grant-u-ben").click();
  await expect(ben.getByTestId("user-error-u-ben")).toContainText("Give a reason");
  await ben.getByTestId("reason-u-ben").fill("Named by the owner as complaint reviewer.");
  await ben.getByTestId("grant-u-ben").click();
  await expect(page.getByTestId("admin-step-up")).toBeVisible();
  expect(s.roleChanges).toEqual([]);
  await page.getByTestId("admin-step-up-send").click();
  await page.getByTestId("admin-step-up-code").fill("123456");
  await page.getByTestId("admin-step-up-verify").click();
  await expect(page.getByTestId("users-notice")).toContainText("Granted Complaint reviewer to Ben.");
  expect(s.roleChanges).toEqual([{ userId: "u-ben", role: "complaint_reviewer", change: "grant", reason: "Named by the owner as complaint reviewer." }]);
});

test("providers, jobs and the audit log: yes/no only, no diagnostic without a key, older pages by cursor", async ({ page, context }) => {
  await signInAs(context, "commuter,admin");
  const s = await mockN7Api(page);
  await page.goto("/admin/providers");
  await expect(page.getByTestId("jev-key-present")).toHaveText("No");
  await expect(page.getByTestId("jev-diagnostic-blocked")).toContainText("OPENROUTER_API_KEY is not set");
  await expect(page.getByTestId("jev-diagnostic-run")).toHaveCount(0);
  expect(s.diagnostics).toBe(0);
  await page.goto("/admin/jobs");
  await expect(page.getByTestId("jobs-count-dead")).toHaveText("1");
  await expect(page.getByTestId("jobs-retention")).toContainText("dry run, would purge 2 reports");
  await page.goto("/admin/audit");
  await expect(page.getByTestId("audit-table")).toContainText("req-1");
  await page.getByTestId("audit-action").fill("role.*");
  await page.getByTestId("audit-apply").click();
  await expect(page.getByTestId("audit-table")).toContainText("req-1");
  await page.getByTestId("audit-older").click();
  await expect(page.getByTestId("audit-table")).toContainText("req-2");
  expect(s.auditQueries).toContain("?action=role.*");
  expect(s.auditQueries.at(-1)).toContain("before=");
  await expect(page.getByTestId("audit-older")).toBeDisabled();
});

for (const scheme of ["light", "dark"] as const) {
  test(`complaint review and system screens pass axe (${scheme})`, async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signInAs(context, "commuter,complaint_reviewer");
    await mockN7Api(page);
    await page.goto("/admin/complaints");
    await expect(page.getByTestId("admin-step-up")).toBeVisible();
    await axe(page, `complaints-stepup-${scheme}`);
    await page.getByTestId("admin-step-up-send").click();
    await page.getByTestId("admin-step-up-code").fill("123456");
    await page.getByTestId("admin-step-up-verify").click();
    await page.getByTestId(`complaint-open-${N7(1)}`).click();
    await expect(page.getByTestId("complaint-detail")).toBeVisible();
    await axe(page, `complaints-${scheme}`);

    await context.clearCookies();
    await signInAs(context, "commuter,admin");
    for (const [path, id] of [["/admin/users", "users-staff"], ["/admin/providers", "providers-jev"], ["/admin/jobs", "jobs-list"], ["/admin/audit", "audit-table"]] as const) {
      await page.goto(path);
      await expect(page.getByTestId(id)).toBeVisible();
      await axe(page, `${path}-${scheme}`);
    }
  });
}
