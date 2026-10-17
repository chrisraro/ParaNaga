import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { routeNetwork } from "./fixtures/network";

// Report a driver, privately (S18, task B8): 4 steps at /app/report-driver. The API is answered
// with page routes (no database). The camera is a fake: getUserMedia returns a canvas stream, and
// every track handed out is recorded on window.__tracks so the spec can check none is left live.
// Every test checks for CSP (report-only) violations.

const TILE_RE = /tile\.openstreetmap\.org|api\.maptiler\.com/;
const PREFS_KEY = "paranaga.prefs";
const URL_PATH = "/app/report-driver";
const USER = { user: { id: "user-1", name: "Maria", roles: ["commuter"] } };
const MEDIA_ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a12";
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test.skip(({ isMobile }) => !isMobile, "The app lives behind the phone-only gate");

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 2, name });

type CameraMode = "ok" | "denied";

async function fakeCamera(page: Page, mode: CameraMode) {
  await page.addInitScript((m: CameraMode) => {
    const w = window as unknown as { __tracks: MediaStreamTrack[]; __gumCalls: number };
    w.__tracks = [];
    w.__gumCalls = 0;
    const devices = navigator.mediaDevices ?? ({} as MediaDevices);
    devices.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      w.__gumCalls += 1;
      if (m === "denied") throw new DOMException("Permission denied", "NotAllowedError");
      if (constraints?.audio) throw new Error("audio must never be requested");
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext("2d")!;
      let frame = 0;
      const paint = () => {
        ctx.fillStyle = frame++ % 2 ? "#2a7" : "#7a2";
        ctx.fillRect(0, 0, 320, 240);
      };
      paint();
      const timer = setInterval(paint, 100);
      const stream = canvas.captureStream(10);
      for (const t of stream.getTracks()) {
        w.__tracks.push(t);
        t.addEventListener("ended", () => clearInterval(timer));
        const stop = t.stop.bind(t);
        t.stop = () => {
          clearInterval(timer);
          stop();
        };
      }
      return stream;
    };
    if (!navigator.mediaDevices) Object.defineProperty(navigator, "mediaDevices", { value: devices });
  }, mode);
}

const liveTracks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __tracks?: MediaStreamTrack[] }).__tracks?.filter((t) => t.readyState === "live").length ?? 0);
const gumCalls = (page: Page) => page.evaluate(() => (window as unknown as { __gumCalls?: number }).__gumCalls ?? 0);

async function mockApi(page: Page, opts: { signedIn: boolean }) {
  await page.route(TILE_RE, (route) => route.abort());
  await routeNetwork(page);
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "private, no-store" }, body: JSON.stringify(opts.signedIn ? USER : { user: null }) }),
  );
}

async function mockUploads(page: Page) {
  const uploads: string[] = [];
  await page.route("**/api/v1/media/slots", async (route) => {
    const req = route.request().postDataJSON() as { purpose: string; mime: string };
    uploads.push(`slot:${req.purpose}:${req.mime}`);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({
        slot: { id: MEDIA_ID, bucket: "quarantine", objectKey: `quarantine/complaint_evidence/2026/${MEDIA_ID}`, uploadUrl: `${new URL(page.url()).origin}/__e2e-upload/${MEDIA_ID}`, maxBytes: 1000000 },
      }),
    });
  });
  await page.route("**/__e2e-upload/**", async (route) => {
    uploads.push(`put:${route.request().method()}`);
    await route.fulfill({ status: 200, body: "" });
  });
  await page.route("**/api/v1/media/confirm", async (route) => {
    uploads.push("confirm");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({ media: { id: MEDIA_ID, bucket: "evidence-private", objectKey: "complaint_evidence/ab/x.jpg", status: "verified", bytes: 10, sha256: "a".repeat(64) } }),
    });
  });
  return uploads;
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

async function open(page: Page) {
  await page.goto(URL_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "Report a driver" })).toBeFocused();
  await expect(heading(page, "Before you start")).toBeVisible();
}

async function fillDetails(page: Page) {
  await page.getByRole("radio", { name: /Overcharging/ }).check();
  await page.getByLabel("What happened?").fill("The driver asked for 40 pesos for a short trip on the loop.");
  await page.getByLabel("Plate number (optional)").fill("abc 1234");
}

test("guest reads the explainer and is asked to sign in", async ({ page }) => {
  await fakeCamera(page, "ok");
  await mockApi(page, { signedIn: false });
  await open(page);
  await expect(page.getByTestId("driver-progress")).toHaveText("Step 1 of 4");
  await expect(page.getByTestId("driver-emergency")).toContainText("In an emergency, call 911.");
  await expect(page.getByTestId("driver-explainer")).toContainText("not sent to Naga City");
  await expect(page.getByTestId("driver-explainer")).toContainText("never posted in Community");
  await expect(page.getByTestId("driver-signin").getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/app/sign-in");
  await expect(page.getByTestId("driver-next")).toHaveCount(0);
  expect(await gumCalls(page)).toBe(0); // no camera permission prompt on load
});

test("signed in: capture, retake, details, review and a private receipt; the camera is always released", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 13.6233869, longitude: 123.1846726, accuracy: 18 });
  await fakeCamera(page, "ok");
  await mockApi(page, { signedIn: true });
  const uploads = await mockUploads(page);
  let sent: Record<string, unknown> | null = null;
  let sentHeaders: Record<string, string> = {};
  await page.route("**/api/v1/complaints", async (route) => {
    sent = route.request().postDataJSON() as Record<string, unknown>;
    sentHeaders = route.request().headers();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: { "cache-control": "private, no-store" },
      body: JSON.stringify({ complaint: { id: "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a99", reference: "PN-7KQ4-2M", category: "overcharging", status: "submitted", submittedAt: "2026-10-18T01:00:00.000Z" } }),
    });
  });

  await open(page);
  await page.getByTestId("driver-next").click();
  await expect(heading(page, "Photo or video")).toBeFocused();
  expect(await gumCalls(page)).toBe(0); // still nothing until the tap

  // Open the camera, take a photo: the preview appears and the camera is released.
  await page.getByTestId("driver-open-camera").click();
  await expect(page.getByTestId("driver-camera")).toBeVisible();
  await expect.poll(() => liveTracks(page)).toBe(1);
  await page.getByTestId("driver-shutter").click();
  await expect(page.getByRole("img", { name: "Photo 1 preview" })).toBeVisible();
  await expect.poll(() => liveTracks(page)).toBe(0);

  // Retake: the old photo goes, the camera opens again.
  await page.getByRole("button", { name: "Retake" }).click();
  await expect(page.getByRole("img", { name: "Photo 1 preview" })).toHaveCount(0);
  await expect.poll(() => liveTracks(page)).toBe(1);
  await page.getByTestId("driver-shutter").click();
  await expect(page.getByRole("img", { name: "Photo 1 preview" })).toBeVisible();

  // Leaving the step with the camera open stops it.
  await page.getByTestId("driver-open-camera").click();
  await expect.poll(() => liveTracks(page)).toBe(1);
  await page.getByTestId("driver-next").click();
  await expect(heading(page, "What happened")).toBeFocused();
  await expect.poll(() => liveTracks(page)).toBe(0);

  // Escape steps out one step with the photo kept; Back to details again.
  await page.keyboard.press("Escape");
  await expect(heading(page, "Photo or video")).toBeFocused();
  await expect(page.getByRole("img", { name: "Photo 1 preview" })).toBeVisible();
  await page.getByTestId("driver-next").click();

  // Details: required checks, then location on tap with accuracy.
  await page.getByTestId("driver-next").click();
  await expect(page.getByTestId("driver-error")).toContainText("Choose what happened");
  await fillDetails(page);
  await expect(page.getByLabel("When did it happen?")).not.toHaveValue("");
  await page.getByTestId("driver-add-location").click();
  await expect(page.getByTestId("driver-location")).toContainText("accurate to about 18 m");
  await page.getByLabel("Or describe the place").fill("Near the plaza");
  await page.getByTestId("driver-next").click();

  await expect(heading(page, "Review and send")).toBeFocused();
  const summary = page.getByTestId("driver-summary");
  await expect(summary).toContainText("Overcharging");
  await expect(summary).toContainText("ABC 1234");
  await expect(summary).toContainText("about 18 m · Near the plaza");
  await expect(page.getByTestId("driver-ack-notice")).toContainText("not automatically sent to Naga City");

  await page.getByTestId("driver-send").click();
  await expect(page.getByTestId("driver-error")).toContainText("Tick the box");
  expect(sent).toBeNull();
  await page.getByTestId("driver-ack").check();
  await page.getByTestId("driver-send").click();

  await expect(heading(page, "Report sent privately")).toBeFocused();
  await expect(page.getByTestId("driver-reference")).toHaveText("PN-7KQ4-2M");
  await expect(page.getByTestId("driver-receipt")).toContainText("Received");
  await expect(page.getByTestId("driver-mynaga")).toHaveAttribute("href", "/app/mynaga");
  await expect(page.getByTestId("driver-receipt")).not.toContainText(/\b(ETA|live|arriving|e-jeep\w*)\b/i);

  expect(uploads).toEqual(["slot:complaint_evidence:image/jpeg", "put:PUT", "confirm"]);
  expect(sent).toMatchObject({
    category: "overcharging",
    plate: "ABC 1234",
    locationText: "Near the plaza",
    gps: { accuracyM: 18 },
    evidence: [{ mediaId: MEDIA_ID, captureKind: "in_app_camera" }],
    noticeAccepted: true,
  });
  expect(Object.keys(sent!).sort()).toEqual(
    ["category", "clientRequestId", "description", "evidence", "gps", "incidentAt", "locationText", "noticeAccepted", "plate"].sort(),
  );
  expect(sentHeaders["content-type"]).toContain("application/json");
  expect(await liveTracks(page)).toBe(0);
});

test("camera denied: explains, and the upload fallback works", async ({ page }) => {
  await fakeCamera(page, "denied");
  await mockApi(page, { signedIn: true });
  await open(page);
  await page.getByTestId("driver-next").click();
  await page.getByTestId("driver-open-camera").click();
  await expect(page.getByTestId("driver-camera-denied")).toContainText("upload a photo or video instead");
  await page.getByTestId("driver-file").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG_1PX });
  await expect(page.getByRole("img", { name: "Photo 1 preview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retake" })).toHaveCount(0);
  await page.getByRole("button", { name: "Remove photo 1" }).click();
  await expect(page.getByTestId("driver-next")).toHaveText("Continue without photo");
});

test("closing the screen with the camera open releases it", async ({ page }) => {
  await fakeCamera(page, "ok");
  await mockApi(page, { signedIn: true });
  await open(page);
  await page.getByTestId("driver-next").click();
  await page.getByTestId("driver-open-camera").click();
  await expect.poll(() => liveTracks(page)).toBe(1);
  // Escape steps back to step 1, which unmounts the camera.
  await page.keyboard.press("Escape");
  await expect(heading(page, "Before you start")).toBeFocused();
  await expect.poll(() => liveTracks(page)).toBe(0);
  // And leaving the screen from step 2 does too.
  await page.getByTestId("driver-next").click();
  await page.getByTestId("driver-open-camera").click();
  await expect.poll(() => liveTracks(page)).toBe(1);
  await page.getByTestId("detail-back").click();
  await expect(page).toHaveURL(/\/app$/);
  await expect.poll(() => liveTracks(page)).toBe(0);
});

for (const scheme of ["light", "dark"] as const) {
  test(`all four steps pass axe: ${scheme}`, async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => {
        if (!sessionStorage.getItem("__prefsSeeded")) {
          localStorage.setItem(key, value);
          sessionStorage.setItem("__prefsSeeded", "1");
        }
      },
      [PREFS_KEY, JSON.stringify({ theme: scheme })] as const,
    );
    await fakeCamera(page, "ok");
    await mockApi(page, { signedIn: true });
    await open(page);
    await expectAxeClean(page);

    await page.getByTestId("driver-next").click();
    await expect(heading(page, "Photo or video")).toBeFocused();
    await page.getByTestId("driver-open-camera").click();
    await page.getByTestId("driver-shutter").click();
    await expect(page.getByRole("img", { name: "Photo 1 preview" })).toBeVisible();
    await expectAxeClean(page);

    await page.getByTestId("driver-next").click();
    await expect(heading(page, "What happened")).toBeFocused();
    await fillDetails(page);
    await expectAxeClean(page);

    await page.getByTestId("driver-next").click();
    await expect(heading(page, "Review and send")).toBeFocused();
    await expectAxeClean(page);
  });
}
