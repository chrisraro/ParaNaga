import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { routeNetwork } from "./fixtures/network";

// My reports (S19) and the MyNaga handoff (S20), task B9. The API is answered with page routes
// (no database). Covers: a guest sign-in prompt, the merged newest-first list with honest status
// labels and no report text, the detail screen with the separate self-reported MyNaga panel, the
// handoff (copy summary, the bystander acknowledgement gate on evidence download, verified
// external links, the self-report toggle) and axe in light and dark on the list, a detail and the
// handoff. Reporter actions (0038): answering a reviewer (text, files, a 409 that keeps the text),
// withdrawing with a confirm dialog, keyboard focus, axe in both themes and no sideways scroll at
// 320 px. Every test checks for CSP (report-only) violations.

const TILE_RE = /tile\.openstreetmap\.org|api\.maptiler\.com/;
const PREFS_KEY = "paranaga.prefs";
const USER = { user: { id: "user-1", name: "Maria", roles: ["commuter"] } };
const COMPLAINT_ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a99";
const CORRECTION_ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a55";
const EVIDENCE_ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a77";
const UPLOAD_ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8b02";
const DESCRIPTION = "The driver asked for 40 pesos for a short trip on the loop.";
const PRIVATE_HEADERS = { "cache-control": "private, no-store" };

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

type Handoff = { submitted: boolean; submittedAt: string | null; reference: string | null };
type Ev = { status: string; at: string; note: string | null; own?: boolean };

const complaintDetail = (handoff: Handoff, status = "under_review", events?: Ev[]) => ({
  complaint: {
    id: COMPLAINT_ID,
    reference: "PN-7KQ4-2M",
    category: "overcharging",
    status,
    submittedAt: "2026-10-17T16:00:00.000Z",
    incidentAt: "2026-10-17T14:30:00.000Z",
    description: DESCRIPTION,
    locationText: "Near the plaza",
    operator: null,
    plate: "ABC 1234",
    bodyNumber: null,
    outcomeCode: null,
    evidence: [{ id: EVIDENCE_ID, captureKind: "in_app_camera" }],
    events: events ?? [
      { status: "submitted", at: "2026-10-17T16:00:00.000Z", note: null },
      { status: "under_review", at: "2026-10-18T01:00:00.000Z", note: null },
    ],
    handoff,
  },
});

async function mockApi(page: Page, opts: { signedIn: boolean; stepUp?: boolean; complaintStatus?: string; answers?: "ok" | "conflict" | "fail-once" }) {
  const state = {
    complaintStatus: opts.complaintStatus ?? "under_review",
    events: undefined as Ev[] | undefined,
    answered: [] as { text: string; evidence: unknown[] }[],
    withdrawCalls: 0,
    answerCalls: 0,
    uploads: 0,
    handoff: { submitted: false, submittedAt: null, reference: null } as Handoff,
    posted: [] as unknown[],
    evidenceCalls: 0,
    // Step-up (N3): when on, the evidence link answers 403 step_up_required until a right code.
    verified: !opts.stepUp,
    codesSent: 0,
    codesTried: [] as string[],
  };
  await page.route(TILE_RE, (route) => route.abort());
  await routeNetwork(page);
  const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", headers: PRIVATE_HEADERS, body: JSON.stringify(body) });
  await page.route("**/api/v1/me", (route) => route.fulfill(json(opts.signedIn ? USER : { user: null })));
  await page.route("**/api/v1/me/corrections", (route) =>
    route.fulfill(
      json({
        corrections: [
          { id: CORRECTION_ID, category: "wrong_curb_side", entityType: "stop", entityId: "s1", entityLabel: "Centro stop", status: "accepted", submittedAt: "2026-10-10T00:00:00.000Z" },
        ],
      }),
    ),
  );
  await page.route("**/api/v1/me/complaints", (route) =>
    route.fulfill(
      json({
        complaints: [
          { id: COMPLAINT_ID, reference: "PN-7KQ4-2M", category: "overcharging", status: "under_review", submittedAt: "2026-10-17T16:00:00.000Z", incidentAt: "2026-10-17T14:30:00.000Z", evidence: [{ id: EVIDENCE_ID, captureKind: "in_app_camera" }] },
        ],
      }),
    ),
  );
  await page.route(`**/api/v1/me/complaints/${COMPLAINT_ID}`, (route) => route.fulfill(json(complaintDetail(state.handoff, state.complaintStatus, state.events))));
  await page.route(`**/api/v1/me/reports/complaint/${COMPLAINT_ID}/answer`, (route) => {
    state.answerCalls += 1;
    if (opts.answers === "conflict") {
      state.complaintStatus = "under_review";
      return route.fulfill(json({ error: { code: "conflict", message: "x", requestId: "r" } }, 409));
    }
    if (opts.answers === "fail-once" && state.answerCalls === 1) return route.fulfill(json({ error: { code: "internal", message: "x", requestId: "r" } }, 500));
    const body = route.request().postDataJSON() as { text: string; evidence: unknown[] };
    state.answered.push(body);
    state.complaintStatus = "under_review";
    state.events = [
      { status: "submitted", at: "2026-10-17T16:00:00.000Z", note: null },
      { status: "needs_information", at: "2026-10-18T01:00:00.000Z", note: "Which stop was it?" },
      { status: "under_review", at: "2026-10-19T01:00:00.000Z", note: body.text, own: true },
    ];
    return route.fulfill(json({ ok: true }));
  });
  await page.route(`**/api/v1/me/reports/complaint/${COMPLAINT_ID}/withdraw`, (route) => {
    state.withdrawCalls += 1;
    state.complaintStatus = "withdrawn";
    return route.fulfill(json({ ok: true }));
  });
  await page.route("**/api/v1/media/slots", (route) => {
    state.uploads += 1;
    return route.fulfill(
      json(
        { slot: { id: UPLOAD_ID, bucket: "quarantine", objectKey: `quarantine/complaint_evidence/2026/${UPLOAD_ID}`, uploadUrl: `${new URL(page.url()).origin}/__e2e-upload/${UPLOAD_ID}`, maxBytes: 1000000 } },
        201,
      ),
    );
  });
  await page.route("**/__e2e-upload/**", (route) => route.fulfill({ status: 200, body: "" }));
  await page.route("**/api/v1/media/confirm", (route) =>
    route.fulfill(json({ media: { id: UPLOAD_ID, bucket: "evidence-private", objectKey: "complaint_evidence/ab/x.jpg", status: "verified", bytes: 4, sha256: "a".repeat(64) } })),
  );
  await page.route(`**/api/v1/me/corrections/${CORRECTION_ID}`, (route) =>
    route.fulfill(
      json({
        correction: {
          id: CORRECTION_ID,
          category: "wrong_curb_side",
          entityType: "stop",
          entityId: "s1",
          entityLabel: "Centro stop",
          status: "accepted",
          submittedAt: "2026-10-10T00:00:00.000Z",
          description: "The stop is on the other side of the road.",
          events: [
            { status: "submitted", at: "2026-10-10T00:00:00.000Z" },
            { status: "needs_evidence", at: "2026-10-11T00:00:00.000Z", reason: "need_photo" },
            { status: "accepted", at: "2026-10-12T00:00:00.000Z" },
          ],
        },
      }),
    ),
  );
  await page.route(`**/api/v1/me/complaints/${COMPLAINT_ID}/evidence/${EVIDENCE_ID}`, (route) => {
    state.evidenceCalls += 1;
    if (!state.verified) {
      return route.fulfill(json({ error: { code: "step_up_required", message: "Enter a new code from your email to continue.", requestId: "r" } }, 403));
    }
    return route.fulfill(json({ url: "https://storage.example.net/evidence-private/x.jpg?X-Amz-Expires=60", expiresInSeconds: 60 }));
  });
  await page.route("**/api/v1/me/step-up/code", (route) => {
    state.codesSent += 1;
    return route.fulfill(json({ sent: true }));
  });
  await page.route("**/api/v1/me/step-up", (route) => {
    const { code } = route.request().postDataJSON() as { code: string };
    state.codesTried.push(code);
    if (code !== "123456") return route.fulfill(json({ error: { code: "bad_request", message: "x", requestId: "r" } }, 400));
    state.verified = true;
    return route.fulfill(json({ verifiedUntil: "2026-10-22T06:00:00.000Z" }));
  });
  await page.route("https://storage.example.net/**", (route) => route.abort());
  await page.route(`**/api/v1/me/reports/complaint/${COMPLAINT_ID}/mynaga`, async (route) => {
    const body = route.request().postDataJSON() as { submitted: boolean; reference?: string };
    state.posted.push(body);
    state.handoff = { submitted: body.submitted, submittedAt: body.submitted ? "2026-10-18T02:00:00.000Z" : null, reference: body.submitted ? (body.reference ?? null) : null };
    await route.fulfill(json({ handoff: state.handoff }));
  });
  return state;
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

const seedTheme = (page: Page, scheme: "light" | "dark") =>
  page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem("__prefsSeeded")) {
        localStorage.setItem(key, value);
        sessionStorage.setItem("__prefsSeeded", "1");
      }
    },
    [PREFS_KEY, JSON.stringify({ theme: scheme })] as const,
  );

test("a guest is asked to sign in and no report endpoint is called", async ({ page }) => {
  await mockApi(page, { signedIn: false });
  const calls: string[] = [];
  page.on("request", (r) => {
    if (/\/api\/v1\/me\/(corrections|complaints)/.test(r.url())) calls.push(r.url());
  });
  await page.goto("/app/reports");
  await expect(page.getByRole("heading", { level: 1, name: "My reports" })).toBeFocused();
  await expect(page.getByTestId("reports-signin").getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/app/sign-in");
  await expect(page.getByTestId("reports-list")).toHaveCount(0);
  expect(calls).toEqual([]);
});

test("the list is newest first, shows reference, category, date and status, and no report text", async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto("/app/reports");
  const list = page.getByTestId("reports-list");
  await expect(list).toBeVisible();
  const rows = list.getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Driver report: Overcharging");
  await expect(rows.nth(0)).toContainText("PN-7KQ4-2M");
  await expect(rows.nth(0)).toContainText("Being reviewed");
  await expect(rows.nth(1)).toContainText("Correction: Wrong curb side");
  await expect(rows.nth(1)).toContainText("Accepted");
  await expect(page.getByTestId("reports-list-screen")).not.toContainText(DESCRIPTION);
  await expect(page.getByTestId("reports-list-screen")).not.toContainText("ABC 1234");
  await expect(page.getByTestId("reports-list-screen")).not.toContainText(/\b(ETA|live|arriving|e-jeep\w*)\b/i);
  // Entry point from the More screen.
  await page.goto("/app/more");
  await expect(page.getByTestId("settings-my-reports")).toHaveAttribute("href", "/app/reports");
});

test("the detail shows the owner's own content, the timeline and a separate self-reported MyNaga panel", async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto("/app/reports");
  await page.getByTestId("report-row-complaint").click();
  await expect(page.getByTestId("report-ref")).toHaveText("PN-7KQ4-2M");
  await expect(page.getByTestId("report-timeline")).toContainText("Received");
  await expect(page.getByTestId("report-timeline")).toContainText("Being reviewed");
  await expect(page.getByTestId("report-content")).toContainText(DESCRIPTION);
  await expect(page.getByTestId("report-content")).toContainText("ABC 1234");
  const panel = page.getByTestId("report-mynaga-panel");
  await expect(panel).toContainText("MyNaga (self-reported)");
  await expect(panel).toContainText("cannot confirm that your report was received");
  await expect(page.getByTestId("report-mynaga-state")).toContainText("You have not said you submitted this in MyNaga.");
  await expect(page.getByTestId("report-mynaga-link")).toHaveAttribute("href", `/app/mynaga?report=${COMPLAINT_ID}`);

  await page.goto("/app/reports");
  await page.getByTestId("report-row-correction").click();
  await expect(page.getByTestId("report-content")).toContainText("The stop is on the other side of the road.");
  // N6: the reviewer's templated reason, in the reporter's language; never the reviewer's note.
  await expect(page.getByTestId("report-timeline")).toContainText("Needs more detail");
  await expect(page.getByTestId("report-timeline")).toContainText("Please add a photo of what you saw.");
  await expect(page.getByTestId("report-mynaga-panel")).toHaveCount(0);
});

test("handoff: copy summary, bystander gate on the evidence download, verified links and the self-report", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const state = await mockApi(page, { signedIn: true });
  await page.goto(`/app/mynaga?report=${COMPLAINT_ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "Report in MyNaga" })).toBeFocused();
  await expect(page.getByTestId("mynaga-independent")).toContainText("Opening MyNaga does not submit your report.");

  // 1 Prepare: the summary is shown, and Copy puts exactly that text on the clipboard.
  const summary = page.getByTestId("handoff-summary");
  await expect(summary).toHaveValue(/Category: Overcharging/);
  await expect(summary).toHaveValue(/Plate number: ABC 1234/);
  await expect(summary).toHaveValue(/Photo or video evidence is available/);
  await page.getByTestId("handoff-copy").click();
  await expect(page.getByTestId("handoff-copy-status")).toContainText("Summary copied");
  // The OS clipboard may turn newlines into CRLF and add trailing spaces on some platforms.
  const norm = (t: string) => t.split(/\r?\n/).map((l) => l.trimEnd()).join("|");
  expect(norm(await page.evaluate(() => navigator.clipboard.readText()))).toBe(norm(await summary.inputValue()));

  // The evidence download is gated behind the bystander acknowledgement.
  await expect(page.getByTestId("handoff-bystander")).toContainText("other people's faces and vehicle plates");
  const download = page.getByTestId("handoff-download-1");
  await expect(download).toBeDisabled();
  expect(state.evidenceCalls).toBe(0);
  await page.getByTestId("handoff-ack").check();
  await expect(download).toBeEnabled();
  await download.click();
  await expect(page.getByTestId("handoff-download-status")).toContainText("File 1 is downloading");
  expect(state.evidenceCalls).toBe(1);
  await page.getByTestId("handoff-ack").uncheck();
  await expect(download).toBeDisabled();

  // 2 Open MyNaga: only the verified links from the repo, external and noopener.
  const links = page.getByTestId("mynaga-links").getByRole("link");
  await expect(links).toHaveCount(4);
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).toHaveAttribute("href", /^https:\/\/(play\.google\.com|apps\.apple\.com|mynaga\.app|www2\.naga\.gov\.ph)\//);
  }

  // 3 Self-report: honest copy, then the toggle with an optional reference.
  await expect(page.getByTestId("handoff-selfreport-note")).toContainText("does not send anything to MyNaga or City Hall");
  await expect(page.getByTestId("handoff-selfreport-note")).toContainText("cannot confirm your report was received");
  await expect(page.getByTestId("handoff-reference")).toHaveCount(0);
  await page.getByTestId("handoff-submitted").check();
  await page.getByTestId("handoff-reference").fill("MN-2026-0042");
  await page.getByTestId("handoff-save").click();
  await expect(page.getByTestId("handoff-save-status")).toContainText("submitted in MyNaga (self-reported)");
  expect(state.posted).toEqual([{ submitted: true, reference: "MN-2026-0042" }]);
  await expect(page.getByTestId("handoff-saved-state")).toContainText("reference MN-2026-0042");

  // The report's own status is untouched; the detail shows the note as the person's own.
  await page.goto(`/app/reports/complaint/${COMPLAINT_ID}`);
  await expect(page.getByTestId("report-timeline")).toContainText("Being reviewed");
  await expect(page.getByTestId("report-mynaga-state")).toContainText("You said you submitted this in MyNaga");
  await expect(page.getByTestId("report-mynaga-state")).toContainText("MN-2026-0042");

  // Taking it back posts submitted false and no reference.
  await page.goto(`/app/mynaga?report=${COMPLAINT_ID}`);
  await page.getByTestId("handoff-submitted").uncheck();
  await page.getByTestId("handoff-save").click();
  await expect(page.getByTestId("handoff-save-status")).toContainText("not marked as submitted");
  expect(state.posted.at(-1)).toEqual({ submitted: false });
});

test("step-up: an original download asks for a fresh email code first, then continues", async ({ page }) => {
  const state = await mockApi(page, { signedIn: true, stepUp: true });
  await page.goto(`/app/mynaga?report=${COMPLAINT_ID}`);
  await page.getByTestId("handoff-ack").check();
  await page.getByTestId("handoff-download-1").click();

  const prompt = page.getByTestId("step-up");
  await expect(prompt).toContainText("Confirm it's you");
  await expect(page.getByTestId("handoff-download-status")).not.toContainText("downloading");
  await page.getByTestId("step-up-send").click();
  await expect(prompt).toContainText("We sent a code to your email");
  expect(state.codesSent).toBe(1);

  await page.getByTestId("step-up-code").fill("000000");
  await page.getByTestId("step-up-verify").click();
  await expect(page.getByTestId("step-up-error")).toContainText("That code did not work");

  await page.getByTestId("step-up-code").fill("123456");
  await page.getByTestId("step-up-verify").click();
  await expect(prompt).toHaveCount(0);
  await expect(page.getByTestId("handoff-download-status")).toContainText("File 1 is downloading");
  expect(state.codesTried).toEqual(["000000", "123456"]);
  expect(state.evidenceCalls).toBe(2);
  await expectAxeClean(page);
});

test("a guest on the handoff is asked to sign in; without a report it is the plain guide", async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto(`/app/mynaga?report=${COMPLAINT_ID}`);
  await expect(page.getByTestId("handoff-signin")).toBeVisible();
  await page.goto("/app/mynaga");
  await expect(page.getByTestId("mynaga-later")).toContainText("Open it from My reports");
  await expect(page.getByTestId("mynaga-reports-link")).toHaveAttribute("href", "/app/reports");
});

test("Escape on a report detail goes back one step", async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto("/app/reports");
  await page.getByTestId("report-row-complaint").click();
  await expect(page.getByTestId("report-ref")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/app\/reports$/);
});

for (const scheme of ["light", "dark"] as const) {
  test(`list, detail and handoff pass axe: ${scheme}`, async ({ page }) => {
    await seedTheme(page, scheme);
    await mockApi(page, { signedIn: true });

    await page.goto("/app/reports");
    await expect(page.getByTestId("reports-list")).toBeVisible();
    await expectAxeClean(page);

    await page.getByTestId("report-row-complaint").click();
    await expect(page.getByTestId("report-ref")).toBeVisible();
    await expectAxeClean(page);

    await page.goto(`/app/mynaga?report=${COMPLAINT_ID}`);
    await expect(page.getByTestId("handoff-summary")).toBeVisible();
    await page.getByTestId("handoff-ack").check();
    await page.getByTestId("handoff-submitted").check();
    await expectAxeClean(page);
  });
}


// ------------------------------------------------------------------ reporter actions (0038)

const detailUrl = `/app/reports/complaint/${COMPLAINT_ID}`;
const tinyJpeg = { name: "street.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };

test("answering a reviewer: the form is labelled, empty is refused, files are listed, and the answer shows in the timeline", async ({ page }) => {
  const state = await mockApi(page, { signedIn: true, complaintStatus: "needs_information" });
  await page.goto(detailUrl);
  const form = page.getByTestId("answer-form");
  await expect(form.getByLabel("Your answer")).toBeVisible();

  // Keyboard: an empty answer is refused with focus back in the field and the error read out.
  await form.getByTestId("answer-send").focus();
  await page.keyboard.press("Enter");
  await expect(form.getByLabel("Your answer")).toBeFocused();
  await expect(form.getByTestId("answer-error")).toContainText("Write your answer first.");
  expect(state.answerCalls).toBe(0);

  await form.getByLabel("Your answer").fill("It was the Centro stop.");
  await form.getByTestId("answer-file-input").setInputFiles(tinyJpeg);
  await expect(form.getByTestId("answer-files")).toContainText("street.jpg");
  await form.getByRole("button", { name: "Remove street.jpg" }).click();
  await expect(form.getByTestId("answer-files")).toHaveCount(0);
  await form.getByTestId("answer-file-input").setInputFiles(tinyJpeg);
  await form.getByTestId("answer-send").click();

  // Success: the form is gone, the status message holds focus, and the answer is labelled "You answered".
  await expect(form).toHaveCount(0);
  const note = page.getByTestId("report-note");
  await expect(note).toHaveText("Your answer was sent. A reviewer will look at the report again.");
  await expect(note).toBeFocused();
  await expect(page.getByTestId("report-timeline")).toContainText("You answered: It was the Centro stop.");
  expect(state.answered).toHaveLength(1);
  expect(state.answered[0]?.text).toBe("It was the Centro stop.");
  expect(state.answered[0]?.evidence).toHaveLength(1);
  expect(state.uploads).toBe(1);
});

test("a failed send keeps the text and the file; the retry does not upload the file again", async ({ page }) => {
  const state = await mockApi(page, { signedIn: true, complaintStatus: "needs_information", answers: "fail-once" });
  await page.goto(detailUrl);
  const form = page.getByTestId("answer-form");
  await form.getByLabel("Your answer").fill("Please keep this.");
  await form.getByTestId("answer-file-input").setInputFiles(tinyJpeg);
  await form.getByTestId("answer-send").click();
  await expect(form.getByTestId("answer-error")).toContainText("What you wrote is kept");
  await expect(form.getByLabel("Your answer")).toHaveValue("Please keep this.");
  await expect(form.getByTestId("answer-files")).toContainText("street.jpg");
  await form.getByTestId("answer-send").click();
  await expect(form).toHaveCount(0);
  expect(state.uploads).toBe(1);
  expect(state.answerCalls).toBe(2);
});

test("409: the report is reloaded, the change is said, and the typed text stays on screen", async ({ page }) => {
  await mockApi(page, { signedIn: true, complaintStatus: "needs_information", answers: "conflict" });
  await page.goto(detailUrl);
  const form = page.getByTestId("answer-form");
  await form.getByLabel("Your answer").fill("Words I do not want to lose.");
  await form.getByTestId("answer-send").click();
  await expect(page.getByTestId("report-note")).toContainText("This report changed in the meantime.");
  await expect(page.getByTestId("report-note")).toBeFocused();
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId("report-unsent").getByLabel("Your unsent answer")).toHaveValue("Words I do not want to lose.");
  await expect(page.getByTestId("report-timeline")).toContainText("Being reviewed");
});

test("withdraw: Cancel keeps the report; Withdraw asks first, then deletes after 30 days and moves focus to the message", async ({ page }) => {
  const state = await mockApi(page, { signedIn: true, complaintStatus: "submitted" });
  await page.goto(detailUrl);
  const open = page.getByTestId("withdraw-open");
  await open.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByTestId("withdraw-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("deleted after 30 days");
  await expect(dialog).toContainText("cannot undo");
  await expect(dialog).toContainText("legal hold");
  // Focus starts on the safe choice and Escape cancels, handing focus back.
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  expect(state.withdrawCalls).toBe(0);

  await open.click();
  await dialog.getByRole("button", { name: "Withdraw report" }).click();
  await expect(open).toHaveCount(0);
  await expect(page.getByTestId("report-note")).toHaveText("You withdrew this report. It will be deleted after 30 days.");
  await expect(page.getByTestId("report-note")).toBeFocused();
  expect(state.withdrawCalls).toBe(1);
});

test("under review: no withdraw button, and one line says why", async ({ page }) => {
  await mockApi(page, { signedIn: true });
  await page.goto(detailUrl);
  await expect(page.getByTestId("withdraw-open")).toHaveCount(0);
  await expect(page.getByTestId("report-withdraw")).toContainText("cannot be withdrawn");
});

test("the answer form and the withdraw button do not scroll the page sideways at 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await mockApi(page, { signedIn: true, complaintStatus: "needs_information" });
  await page.goto(detailUrl);
  await page.getByTestId("answer-form").getByLabel("Your answer").fill("w".repeat(400));
  await page.getByTestId("answer-form").getByTestId("answer-file-input").setInputFiles({ ...tinyJpeg, name: `${"long-name-".repeat(8)}.jpg` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expect(page.getByTestId("withdraw-open")).toBeVisible();
  await page.getByTestId("withdraw-open").click();
  await expect(page.getByTestId("withdraw-dialog")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the answer form and the withdraw dialog pass axe: ${scheme}`, async ({ page }) => {
    await seedTheme(page, scheme);
    await mockApi(page, { signedIn: true, complaintStatus: "needs_information" });
    await page.goto(detailUrl);
    const form = page.getByTestId("answer-form");
    await form.getByLabel("Your answer").fill("An answer.");
    await form.getByTestId("answer-file-input").setInputFiles(tinyJpeg);
    await expect(form.getByTestId("answer-files")).toBeVisible();
    await form.getByTestId("answer-send").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("report-note")).toBeFocused();
    await expectAxeClean(page);
  });

  test(`the withdraw dialog passes axe: ${scheme}`, async ({ page }) => {
    await seedTheme(page, scheme);
    await mockApi(page, { signedIn: true, complaintStatus: "submitted" });
    await page.goto(detailUrl);
    await page.getByTestId("withdraw-open").click();
    await expect(page.getByTestId("withdraw-dialog")).toBeVisible();
    await expectAxeClean(page);
  });
}
