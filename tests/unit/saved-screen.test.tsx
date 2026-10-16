// @vitest-environment jsdom
// The Saved screen (src/ui/saved/saved-screen.tsx) over a fake IndexedDB: the three sections, the
// verbatim copy, the revision check of saved trips, what "Open trip" and a place row do, and the
// trip-history switch (nothing recorded while it is off).
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planResponseSchema } from "@/domain/api/plan";
import { RECORD_FORMAT, buildSavedTrip } from "@/domain/saved/saved";
import { PROVISIONAL_PLAN, REVISION } from "../e2e/fixtures/plan-responses";

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  useRouter: () => ({ back: vi.fn(), push: nav.push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/saved",
}));

const { AppFrameContext } = await import("@/ui/app-shell/app-frame-context");
const { NO_PLACES, NO_TRIPS, TRIPS_INTRO, SavedScreen } = await import("@/ui/saved/saved-screen");
const db = await import("@/client/storage/db");
const { recordTrip } = await import("@/client/history/trip-history");
const { updatePrefs } = await import("@/client/prefs/use-prefs");
const { resetSnapshotForTests } = await import("@/client/network/use-snapshot");

const plan = planResponseSchema.parse(PROVISIONAL_PLAN);
const card = buildSavedTrip({
  id: "t1",
  savedAt: "2026-10-16T02:00:00.000Z",
  data: plan,
  option: plan.plan.options[0]!,
  start: { label: "Plaza Rizal", point: { lat: 13.6224, lng: 123.1838 } },
  destination: { label: "Avenue Square", point: { lat: 13.6305, lng: 123.1912 } },
});

const frame = {
  openPanel: () => () => {},
  markHomeNavigation: () => {},
  isHomeNavigation: () => false,
  mapFocus: null,
  showOnMap: () => {},
  hideTabBar: () => () => {},
  tabBarVisible: true,
  tabBarClearance: 0,
  panelOpen: true,
  endpointRequest: null,
  requestEndpoint: vi.fn(),
  requestPick: vi.fn(),
  requestGps: vi.fn(),
  tripRequest: null,
  requestTrip: vi.fn(),
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
let head: unknown = REVISION;
let snapshot: unknown = null;
let urls: string[] = [];

beforeEach(async () => {
  // The published snapshot is shared per page (use-snapshot.ts): every test starts without one.
  resetSnapshotForTests();
  await db.clearAllStores();
  localStorage.clear();
  head = REVISION;
  snapshot = null;
  urls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(url);
      if (url === "/api/v1/network/head") return json(head);
      if (url.startsWith("/api/v1/network/snapshot/") && snapshot) return json(snapshot);
      return new Response("{}", { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  nav.params = new URLSearchParams();
});

function renderSaved(tab?: string) {
  if (tab) nav.params = new URLSearchParams({ tab });
  return render(
    <AppFrameContext.Provider value={frame}>
      <SavedScreen />
    </AppFrameContext.Provider>,
  );
}

describe("Saved → Trips", () => {
  it("empty: the intro and the verbatim empty line", async () => {
    renderSaved();
    expect(await screen.findByTestId("saved-trips-empty")).toBeTruthy();
    expect(screen.getByText(TRIPS_INTRO)).toBeTruthy();
    expect(screen.getByTestId("saved-trips-empty").textContent).toBe(NO_TRIPS);
  });

  it("a saved trip card works as text; Open trip asks the map to restore it", async () => {
    await db.putSavedTrip(card);
    renderSaved();
    const tripCard = await screen.findByTestId("saved-trip");
    expect(tripCard.textContent).toContain("Available offline");
    expect(tripCard.textContent).toContain("From Plaza Rizal");
    expect(screen.getByRole("heading", { level: 2, name: "Avenue Square" })).toBeTruthy();
    expect(tripCard.textContent).toContain(" · Estimate ₱14 · data from 16 Oct 2026");
    expect(tripCard.textContent).not.toContain("Time not available");
    expect(tripCard.textContent).toContain("Saved 16 Oct 2026");
    expect(tripCard.textContent).toContain("Loop A");
    await waitFor(() => expect(urls).toContain("/api/v1/network/head"));
    expect(tripCard.textContent).not.toContain("Changed since saved");
    // No coordinates go anywhere: the only requests are the head and the snapshot of its revision.
    expect(urls.every((u) => !/13\.6|123\.1/.test(u))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Open trip" }));
    expect(frame.requestTrip).toHaveBeenCalledWith("t1");
    expect(nav.push).toHaveBeenCalledWith("/app");
  });

  it("badges a trip whose route changed in a newer revision and offers Review changes", async () => {
    await db.putSavedTrip(card);
    const next = "11111111-2222-4333-8444-555555555555";
    head = { ...REVISION, revisionId: next, label: "next" };
    snapshot = { revision: head, stops: [], variants: [], fareRules: [], terminals: [], routes: [] };
    renderSaved();
    expect(await screen.findByTestId("saved-trip-changed")).toBeTruthy();
    expect(screen.getByTestId("saved-trip-changed").textContent).toBe("Changed since saved");
    expect(urls).toContain(`/api/v1/network/snapshot/${next}`);
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(frame.requestTrip).toHaveBeenCalledWith("t1");
  });

  it("offline: the cards still show, without a verdict", async () => {
    await db.putSavedTrip(card);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    renderSaved();
    expect(await screen.findByRole("button", { name: "Open trip" })).toBeTruthy();
  });

  it("a failed Undo does not carry over to the next removal", async () => {
    await db.putSavedPlace({ id: "a", label: "Alpha", point: { lat: 13.61, lng: 123.18 }, source: "pinned", savedAt: "2026-10-16T02:00:00.000Z" });
    await db.putSavedPlace({ id: "b", label: "Beta", point: { lat: 13.62, lng: 123.18 }, source: "pinned", savedAt: "2026-10-16T01:00:00.000Z" });
    renderSaved("places");
    fireEvent.click(await screen.findByRole("button", { name: "Remove: Alpha" }));
    await screen.findByText("Removed Alpha.");
    const put = vi.spyOn(db, "putSavedPlace").mockRejectedValueOnce(new Error("blocked"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByText("Could not undo on this phone.");
    put.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Remove: Beta" }));
    await screen.findByText("Removed Beta.");
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("Remove has an Undo note that puts the trip back", async () => {
    await db.putSavedTrip(card);
    renderSaved();
    fireEvent.click(await screen.findByRole("button", { name: "Remove trip to Avenue Square" }));
    await screen.findByTestId("saved-trips-empty");
    expect(screen.getByTestId("saved-undo").textContent).toContain("Removed the trip to Avenue Square.");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByTestId("saved-trip")).toBeTruthy();
  });

  it("a corrupted record gets a note and, after a confirmation, Remove unreadable items", async () => {
    await db.putSavedTrip(card);
    const { openDB } = await import("idb");
    const raw = await openDB(db.DEVICE_DB_NAME);
    await raw.put("savedTrips", { id: "broken" }, "broken");
    raw.close();
    renderSaved();
    const note = await screen.findByTestId("saved-dropped");
    expect(note.textContent).toContain("damaged and can't be read");
    expect(screen.getAllByTestId("saved-trip")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove unreadable items" }));
    expect(screen.getByTestId("saved-remove-unreadable-dialog").hasAttribute("open")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByTestId("saved-dropped")).toBeNull());
    expect((await db.listSavedTrips())).toMatchObject({ dropped: 0, unreadable: 0 });
    expect(screen.getAllByTestId("saved-trip")).toHaveLength(1);
    // The result is announced and survives the notes; focus lands on it.
    const status = screen.getByTestId("saved-dropped-status");
    expect(status.textContent).toBe("Removed 1 damaged item.");
    expect(document.activeElement).toBe(status);
  });

  it("removing a damaged saved place moves focus to the status line", async () => {
    const { openDB } = await import("idb");
    const raw = await openDB(db.DEVICE_DB_NAME);
    await raw.put("savedPlaces", { id: "broken" }, "broken");
    raw.close();
    renderSaved("places");
    fireEvent.click(await screen.findByRole("button", { name: "Remove unreadable items" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByTestId("saved-dropped-status").textContent).toBe("Removed 1 damaged item."));
    expect(document.activeElement).toBe(screen.getByTestId("saved-dropped-status"));
  });

  it("a record from a newer ParaNaga is only mentioned, never offered for removal", async () => {
    const { openDB } = await import("idb");
    const raw = await openDB(db.DEVICE_DB_NAME);
    await raw.put("savedTrips", { ...card, id: "future", v: RECORD_FORMAT + 1 }, "future");
    raw.close();
    renderSaved();
    const note = await screen.findByTestId("saved-dropped");
    expect(note.textContent).toContain("from a newer version of ParaNaga");
    expect(screen.queryByRole("button", { name: "Remove unreadable items" })).toBeNull();
  });
});

describe("Saved → Places", () => {
  it("empty, with Add a place opening search in save mode", async () => {
    renderSaved("places");
    expect((await screen.findByTestId("saved-places-empty")).textContent).toBe(NO_PLACES);
    expect(screen.getByTestId("saved-add-place").getAttribute("href")).toBe("/app/search?for=save");
  });

  it("a row plans to the place; Use as start; Rename; Remove", async () => {
    await db.putSavedPlace({ id: "p1", label: "SM City Naga", point: { lat: 13.62, lng: 123.19 }, source: "osm", savedAt: "2026-10-16T02:00:00.000Z" });
    renderSaved("places");
    const row = await screen.findByTestId("saved-place");
    expect(row.textContent).toContain("Saved place · OpenStreetMap");
    fireEvent.click(screen.getByRole("button", { name: /^SM City Naga/ }));
    expect(frame.requestEndpoint).toHaveBeenLastCalledWith("destination", { point: { lat: 13.62, lng: 123.19 }, label: "SM City Naga", place: "osm" });
    fireEvent.click(screen.getByRole("button", { name: "Use as start: SM City Naga" }));
    expect(frame.requestEndpoint).toHaveBeenLastCalledWith("start", { point: { lat: 13.62, lng: 123.19 }, label: "SM City Naga", place: "osm" });

    fireEvent.click(screen.getByRole("button", { name: "Rename: SM City Naga" }));
    const input = screen.getByTestId("saved-rename-dialog").querySelector("input")!;
    fireEvent.change(input, { target: { value: "The mall" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await screen.findByRole("button", { name: /^The mall/ });

    fireEvent.click(screen.getByRole("button", { name: "Remove: The mall" }));
    await screen.findByTestId("saved-places-empty");
    expect((await db.listSavedPlaces()).records).toEqual([]);
  });
});

describe("Saved → History", () => {
  it("off by default: the artboard copy, a link to More, and nothing is recorded", async () => {
    renderSaved("history");
    expect(screen.getByRole("heading", { name: "History is off" })).toBeTruthy();
    expect(screen.getByText("ParaNaga keeps no record of your trips unless you turn history on. When on, it stays on this device.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Turn on in More" }).getAttribute("href")).toBe("/app/more");
    expect(await recordTrip("Plaza Rizal", "SM City Naga")).toBe(false);
    expect(await db.countHistory()).toBe(0);
  });

  it("on: labels and a date per trip (no coordinates), and Clear history", async () => {
    updatePrefs({ historyEnabled: true });
    expect(await recordTrip("Plaza Rizal", "SM City Naga")).toBe(true);
    renderSaved("history");
    expect(await screen.findByText(/^Plaza Rizal → SM City Naga · \d{1,2} [A-Z][a-z]{2} \d{4}$/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Clear history" }).at(-1)!);
    await waitFor(async () => expect(await db.countHistory()).toBe(0));
  });
});
