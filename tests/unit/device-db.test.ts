import "fake-indexeddb/auto";
import { openDB } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { planResponseSchema } from "@/domain/api/plan";
import { buildSavedTrip, type HistoryEntry, type SavedPlace } from "@/domain/saved/saved";
import {
  DEVICE_DB_NAME,
  addHistoryEntry,
  clearAllStores,
  clearHistoryStore,
  countHistory,
  deleteSavedPlace,
  deleteSavedTrip,
  getSavedTrip,
  listHistory,
  listSavedPlaces,
  listSavedTrips,
  putSavedPlace,
  putSavedTrip,
  readSnapshotMeta,
  subscribeDeviceStore,
  writeSnapshotMeta,
} from "@/client/storage/db";
import { PROVISIONAL_PLAN, REVISION } from "../e2e/fixtures/plan-responses";

const plan = planResponseSchema.parse(PROVISIONAL_PLAN);
const trip = (id: string, savedAt: string) =>
  buildSavedTrip({
    id,
    savedAt,
    data: plan,
    option: plan.plan.options[0]!,
    start: { label: "Plaza Rizal", point: { lat: 13.6224, lng: 123.1838 } },
    destination: { label: "Avenue Square", point: { lat: 13.6305, lng: 123.1912 } },
  });
const place = (id: string, label = "Home"): SavedPlace => ({ id, label, point: { lat: 13.62, lng: 123.18 }, source: "pinned", savedAt: "2026-10-16T02:00:00.000Z" });

/** Writes a value straight into a store, as a corrupted or foreign record would be. */
async function rawPut(store: string, value: unknown) {
  const db = await openDB(DEVICE_DB_NAME);
  await db.put(store, value, (value as { id: string }).id);
  db.close();
}

beforeEach(async () => {
  await clearAllStores();
});

describe("device database (IndexedDB)", () => {
  it("stores, lists newest first, reads and deletes saved trips", async () => {
    await putSavedTrip(trip("a", "2026-10-16T01:00:00.000Z"));
    await putSavedTrip(trip("b", "2026-10-16T02:00:00.000Z"));
    const { records, dropped } = await listSavedTrips();
    expect(records.map((t) => t.id)).toEqual(["b", "a"]);
    expect(dropped).toBe(0);
    expect((await getSavedTrip("a"))?.revisionId).toBe(REVISION.revisionId);
    await deleteSavedTrip("a");
    expect(await getSavedTrip("a")).toBeNull();
  });

  it("drops corrupted records quietly (counted, removed), never throws", async () => {
    await putSavedTrip(trip("good", "2026-10-16T01:00:00.000Z"));
    await rawPut("savedTrips", { id: "bad", option: "nope" });
    await rawPut("savedPlaces", { id: "bad-place", label: "" });
    const trips = await listSavedTrips();
    expect(trips.records.map((t) => t.id)).toEqual(["good"]);
    expect(trips.dropped).toBe(1);
    expect(await getSavedTrip("bad")).toBeNull();
    // Removed, so the note is shown once.
    expect((await listSavedTrips()).dropped).toBe(0);
    const places = await listSavedPlaces();
    expect(places).toEqual({ records: [], dropped: 1 });
  });

  it("refuses to write an invalid record", async () => {
    await expect(putSavedPlace({ ...place("p"), label: "" })).rejects.toThrow();
    expect((await listSavedPlaces()).records).toEqual([]);
  });

  it("stores, renames and removes saved places", async () => {
    await putSavedPlace(place("p1", "Home"));
    await putSavedPlace({ ...place("p1"), label: "Lola's house" });
    expect((await listSavedPlaces()).records.map((p) => p.label)).toEqual(["Lola's house"]);
    await deleteSavedPlace("p1");
    expect((await listSavedPlaces()).records).toEqual([]);
  });

  it("history: newest first, pruned after 90 days on read, counted and cleared", async () => {
    const now = Date.now();
    const entry = (id: string, daysAgo: number): HistoryEntry => ({ id, from: "A", to: "B", at: new Date(now - daysAgo * 86_400_000).toISOString() });
    await addHistoryEntry(entry("old", 120));
    await addHistoryEntry(entry("mid", 10));
    await addHistoryEntry(entry("new", 1));
    expect((await listHistory()).records.map((e) => e.id)).toEqual(["new", "mid"]);
    expect(await countHistory()).toBe(2);
    await clearHistoryStore();
    expect(await countHistory()).toBe(0);
  });

  it("history never stores coordinates", async () => {
    await addHistoryEntry({ id: "h", from: "A", to: "B", at: new Date().toISOString(), point: { lat: 13.6, lng: 123.1 } } as HistoryEntry);
    const db = await openDB(DEVICE_DB_NAME);
    const stored = await db.get("history", "h");
    db.close();
    expect(stored).not.toHaveProperty("point");
  });

  it("snapshot meta round-trips", async () => {
    expect(await readSnapshotMeta()).toBeNull();
    await writeSnapshotMeta({ revisionId: REVISION.revisionId, publishedAt: REVISION.publishedAt });
    expect(await readSnapshotMeta()).toEqual({ revisionId: REVISION.revisionId, publishedAt: REVISION.publishedAt });
  });

  it("notifies subscribers after a write and empties every store on clear", async () => {
    const listener = vi.fn();
    const off = subscribeDeviceStore(listener);
    await putSavedPlace(place("p1"));
    expect(listener).toHaveBeenCalled();
    off();
    await putSavedTrip(trip("a", "2026-10-16T01:00:00.000Z"));
    await addHistoryEntry({ id: "h", from: "A", to: "B", at: new Date().toISOString() });
    await writeSnapshotMeta({ revisionId: REVISION.revisionId, publishedAt: null });
    await clearAllStores();
    expect((await listSavedTrips()).records).toEqual([]);
    expect((await listSavedPlaces()).records).toEqual([]);
    expect(await countHistory()).toBe(0);
    expect(await readSnapshotMeta()).toBeNull();
  });
});
