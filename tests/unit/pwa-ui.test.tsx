// @vitest-environment jsdom
// Task 12 UI: offline copy, the offline banner, the detail panel offline, the update card (never
// during guidance), the install row (only what the browser offers), clearing the data caches, the
// /offline page and the saved trip as text.
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planResponseSchema } from "@/domain/api/plan";
import { buildSavedTrip } from "@/domain/saved/saved";
import { PROVISIONAL_PLAN, REVISION } from "../e2e/fixtures/plan-responses";

const guidance = vi.hoisted(() => ({ active: false, state: { session: {}, card: {} }, listeners: new Set<() => void>() }));
vi.mock("@/client/guidance/guidance-store", () => ({
  subscribeGuidance: (l: () => void) => {
    guidance.listeners.add(l);
    return () => guidance.listeners.delete(l);
  },
  getGuidanceSnapshot: () => (guidance.active ? guidance.state : null),
  getGuidanceServerSnapshot: () => null,
  forgetGuidance: () => undefined,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/stops/x",
  useSearchParams: () => new URLSearchParams(),
}));

const copy = await import("@/domain/pwa/offline-copy");
const { savedTripSteps } = await import("@/domain/saved/trip-text");
const sw = await import("@/client/pwa/register-sw");
const install = await import("@/client/pwa/install");
const db = await import("@/client/storage/db");
const { resetSnapshotForTests } = await import("@/client/network/use-snapshot");
const { clearRuntimeCaches } = await import("@/client/device-data");
const { UpdatePrompt, UPDATE_TEXT } = await import("@/ui/pwa/update-prompt");
const { InstallRow, IOS_INSTALL_TEXT, OTHER_INSTALL_TEXT } = await import("@/ui/pwa/install-row");
const { OfflineBanner } = await import("@/ui/pwa/offline-banner");
const { OfflineScreen } = await import("@/ui/pwa/offline-screen");
const { DetailLoading } = await import("@/ui/detail/detail-frame");
const { AppFrameContext } = await import("@/ui/app-shell/app-frame-context");

const plan = planResponseSchema.parse(PROVISIONAL_PLAN);
const card = buildSavedTrip({
  id: "t1",
  savedAt: "2026-10-16T02:00:00.000Z",
  data: plan,
  option: plan.plan.options[0]!,
  start: { label: "Plaza Rizal", point: { lat: 13.6224, lng: 123.1838 } },
  destination: { label: "Avenue Square", point: { lat: 13.6305, lng: 123.1912 } },
});

function setOnline(online: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
  act(() => {
    window.dispatchEvent(new Event(online ? "online" : "offline"));
  });
}

beforeEach(async () => {
  guidance.active = false;
  sw.resetServiceWorkerForTests();
  install.resetInstallForTests();
  resetSnapshotForTests();
  await db.clearAllStores();
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("offline copy", () => {
  it("names the published date of the data on the phone, or says there is none", () => {
    expect(copy.offlineBannerText("2026-10-15T12:59:57.089Z", true)).toBe("Offline — data from Oct 15, 2026. Fares may have changed.");
    expect(copy.offlineBannerText(null, true)).toBe("Offline — data from your last visit. Fares may have changed.");
    expect(copy.offlineBannerText(null, false)).toBe("Offline — no transport data saved on this phone yet.");
    expect(copy.offlineDataLine("2026-10-15T12:59:57.089Z", true)).toBe("Data from Oct 15, 2026. Fares may have changed.");
    expect(copy.offlinePlanNote("2026-10-15T12:59:57.089Z")).toBe("Planned offline from data of Oct 15, 2026. Fares may have changed.");
    expect(copy.OFFLINE_PANEL_TEXT).toBe("You're offline · This opens when you're back online.");
  });

  it("a saved trip reads as text steps: estimates, pin order, the driver badge, no times", () => {
    const steps = savedTripSteps(card);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatch(/^Walk ≈ 230 m to Plaza Rizal.*\(path not verified\)\.$/);
    expect(steps[1]).toContain("Unverified route — confirm with the driver.");
    expect(steps[1]).toContain("by pin order");
    expect(steps[2]).toBe("Walk ≈ 120 m to Avenue Square (path not verified).");
    expect(steps.join(" ")).not.toMatch(/\bmin\b|minutes|arriv(ing|es) in/i);
  });
});

describe("OfflineBanner", () => {
  it("appears when the browser goes offline, with the date of the data last seen", async () => {
    await db.writeSnapshotMeta({ revisionId: REVISION.revisionId, publishedAt: REVISION.publishedAt });
    render(<OfflineBanner />);
    expect(screen.getByTestId("offline-status").textContent).toBe("");
    setOnline(false);
    expect((await screen.findByTestId("offline-banner")).textContent).toBe("Offline — data from Oct 15, 2026. Fares may have changed.");
    expect(screen.getByTestId("offline-status").getAttribute("role")).toBe("status");
    setOnline(true);
    await waitFor(() => expect(screen.queryByTestId("offline-banner")).toBeNull());
  });
});

describe("DetailLoading", () => {
  const frame = { openPanel: () => () => {}, hideTabBar: () => () => {}, isHomeNavigation: () => false } as never;
  it("says the panel opens when back online instead of a skeleton", async () => {
    render(
      <AppFrameContext.Provider value={frame}>
        <DetailLoading title="Stop" />
      </AppFrameContext.Provider>,
    );
    expect(screen.getByTestId("detail-loading")).toBeTruthy();
    setOnline(false);
    expect((await screen.findByTestId("detail-offline")).textContent).toContain("You're offline · This opens when you're back online.");
  });
});

describe("UpdatePrompt", () => {
  it("shows only while a new version waits, and Reload asks it to take over", () => {
    const worker = { postMessage: vi.fn() } as unknown as ServiceWorker;
    const sw2 = { addEventListener: vi.fn() };
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { serviceWorker: sw2 }));
    render(<UpdatePrompt />);
    expect(screen.queryByTestId("update-prompt")).toBeNull();
    act(() => sw.setWaitingForTests(worker));
    expect(screen.getByTestId("update-prompt").textContent).toContain(UPDATE_TEXT);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(sw2.addEventListener).toHaveBeenCalledWith("controllerchange", expect.any(Function));
  });

  it("never shows, and never reloads, during guidance", () => {
    guidance.active = true;
    const worker = { postMessage: vi.fn() } as unknown as ServiceWorker;
    render(<UpdatePrompt />);
    act(() => sw.setWaitingForTests(worker));
    expect(screen.queryByTestId("update-prompt")).toBeNull();
    act(() => {
      guidance.active = false;
      for (const l of guidance.listeners) l();
    });
    expect(screen.getByTestId("update-prompt")).toBeTruthy();
  });
});

describe("install", () => {
  it("recognises iPhone, iPad (also as a touch Mac) and nothing else as iOS", () => {
    expect(install.isIos("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5)).toBe(true);
    expect(install.isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
    expect(install.isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
    expect(install.isIos("Mozilla/5.0 (Linux; Android 14; Pixel 7)", 5)).toBe(false);
  });

  it("offers the browser's own prompt only after beforeinstallprompt, and only on a tap", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    install.listenForInstallPrompt();
    render(<InstallRow />);
    expect(screen.getByTestId("settings-install").textContent).toContain(OTHER_INSTALL_TEXT);
    const prompt = vi.fn(async () => undefined);
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: "accepted" as const }) });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Install ParaNaga/ }));
    expect(prompt).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("settings-install").textContent).toContain("Installed"));
  });

  it("gives iPhone the Share instructions and says Installed when running installed", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)");
    const { unmount } = render(<InstallRow />);
    expect(screen.getByTestId("settings-install").textContent).toContain(IOS_INSTALL_TEXT);
    expect(screen.queryByRole("button")).toBeNull();
    unmount();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(display-mode: standalone)" }));
    render(<InstallRow />);
    expect(screen.getByTestId("settings-install").textContent).toContain("Installed");
  });
});

describe("clearRuntimeCaches", () => {
  it("deletes the data caches and keeps the precache and the shells", async () => {
    const names = ["serwist-precache-v2-http://localhost/", "pn-shell-b1", "pn-head-b1", "pn-snapshot-b1", "pn-search-index-b1", "pn-reference-b1"];
    const deleted: string[] = [];
    vi.stubGlobal("caches", { keys: async () => names, delete: async (n: string) => (deleted.push(n), true) });
    await clearRuntimeCaches();
    expect(deleted).toEqual(["pn-head-b1", "pn-snapshot-b1", "pn-search-index-b1", "pn-reference-b1"]);
  });
});

describe("/offline", () => {
  it("shows the data date, the two offline links and the saved trips, opening as text", async () => {
    await db.writeSnapshotMeta({ revisionId: REVISION.revisionId, publishedAt: REVISION.publishedAt });
    await db.putSavedTrip(card);
    render(<OfflineScreen />);
    expect(screen.getByRole("heading", { level: 1, name: "You're offline" })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("offline-data-date").textContent).toBe("Data from Oct 15, 2026. Fares may have changed."));
    expect(screen.getByRole("link", { name: "Open the map" }).getAttribute("href")).toBe("/app");
    expect(screen.getByRole("link", { name: "Saved" }).getAttribute("href")).toBe("/app/saved");
    const trip = await screen.findByTestId("offline-trip");
    expect(trip.textContent).toContain("To Avenue Square");
    expect(trip.textContent).toContain("Unverified route — confirm with the driver.");
    expect(trip.textContent).toContain("data from 15 Oct 2026");
  });

  it("says when no trip is saved and no data is on the phone", async () => {
    render(<OfflineScreen />);
    expect(await screen.findByText("No saved trips on this phone.")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("offline-data-date").textContent).toBe("No transport data is saved on this phone yet."));
  });
});
