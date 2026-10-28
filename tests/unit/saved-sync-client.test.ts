import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSavedTrip, type SavedPlace } from "@/domain/saved/saved";
import { planResponseSchema } from "@/domain/api/plan";
import { clearAllStores, deleteSavedPlace, deleteSavedTrip, listSavedPlaces, listSavedTrips, putSavedPlace, putSavedTrip } from "@/client/storage/db";
import { syncSavedItems } from "@/client/saved/sync";
import { PROVISIONAL_PLAN } from "../e2e/fixtures/plan-responses";

const plan = planResponseSchema.parse(PROVISIONAL_PLAN);
const trip = (id: string) =>
  buildSavedTrip({
    id,
    savedAt: "2026-10-16T02:00:00.000Z",
    data: plan,
    option: plan.plan.options[0]!,
    start: { label: "Plaza Rizal", point: { lat: 13.6224, lng: 123.1838 } },
    destination: { label: "Avenue Square", point: { lat: 13.6305, lng: 123.1912 } },
  });
const place = (id: string): SavedPlace => ({ id, label: "Home", point: { lat: 13.62, lng: 123.18 }, source: "pinned", savedAt: "2026-10-16T02:00:00.000Z" });

type Call = { method: string; url: string; body: unknown };
let calls: Call[];
let remote: { places: SavedPlace[]; trips: ReturnType<typeof trip>[] };
let failOn: string | null;

beforeEach(async () => {
  await clearAllStores();
  calls = [];
  remote = { places: [], trips: [] };
  failOn = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (failOn === method) return new Response("{}", { status: 500 });
      if (method === "GET") return Response.json(url.endsWith("places") ? { places: remote.places } : { trips: remote.trips });
      return Response.json({ ok: true });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("syncSavedItems", () => {
  it("a place deleted on this phone is deleted on the account and not downloaded again", async () => {
    remote.places = [place("gone"), place("kept")];
    remote.trips = [trip("gone-trip")];
    await putSavedPlace(place("gone"));
    await putSavedTrip(trip("gone-trip"));
    await deleteSavedPlace("gone");
    await deleteSavedTrip("gone-trip");
    await syncSavedItems();
    expect(calls).toContainEqual({ method: "DELETE", url: "/api/v1/me/saved-places", body: { ids: ["gone"] } });
    expect(calls).toContainEqual({ method: "DELETE", url: "/api/v1/me/saved-trips", body: { ids: ["gone-trip"] } });
    expect((await listSavedPlaces()).records.map((p) => p.id)).toEqual(["kept"]);
    expect((await listSavedTrips()).records).toEqual([]);
    // Acknowledged: the next sync does not repeat the delete.
    calls = [];
    await syncSavedItems();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("saving the same item again cancels its pending delete", async () => {
    await putSavedPlace(place("p"));
    await deleteSavedPlace("p");
    await putSavedPlace(place("p"));
    await syncSavedItems();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("a failed delete is kept and retried, and the sync fails", async () => {
    await putSavedPlace(place("p"));
    await deleteSavedPlace("p");
    failOn = "DELETE";
    await expect(syncSavedItems()).rejects.toThrow();
    failOn = null;
    calls = [];
    await syncSavedItems();
    expect(calls).toContainEqual({ method: "DELETE", url: "/api/v1/me/saved-places", body: { ids: ["p"] } });
  });

  it("fails (never reports up to date) when the account cannot be read or written", async () => {
    failOn = "GET";
    await expect(syncSavedItems()).rejects.toThrow();
    failOn = "POST";
    await putSavedPlace(place("p"));
    await expect(syncSavedItems()).rejects.toThrow();
  });

  it("sends more than 50 items in chunks of 50", async () => {
    for (let i = 0; i < 120; i++) await putSavedPlace(place(`p${i}`));
    const res = await syncSavedItems();
    const posts = calls.filter((c) => c.method === "POST" && c.url.endsWith("places"));
    expect(posts.map((c) => (c.body as { places: unknown[] }).places.length)).toEqual([50, 50, 20]);
    expect(res.placesUploaded).toBe(120);
  });
});
