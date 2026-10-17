import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { clearAllStores, listRecentSearches, recordRecentSearch } from "@/client/storage/db";
import { RECENT_SEARCH_LIMIT, recentKeyForEndpoint, recordRecentSearchEntry, type RecentSearchEntry } from "@/domain/search/recents";

const sample = (i: number): RecentSearchEntry => ({
  key: `osm:${i}`,
  label: `Place ${i}`,
  subtitle: "OpenStreetMap",
  point: { lat: 13.62 + i * 0.001, lng: 123.18 + i * 0.001 },
  place: "osm",
  pickedAt: `2026-10-18T00:00:0${i % 10}.000Z`,
});

describe("recent searches domain and device store", () => {
  beforeEach(async () => {
    await clearAllStores();
  });

  it("caps recent picks at 8, newest first, and dedupes by key or point+label", () => {
    let entries: RecentSearchEntry[] = [];
    for (let i = 1; i <= 10; i += 1) {
      entries = recordRecentSearchEntry(entries, sample(i));
    }
    expect(entries).toHaveLength(RECENT_SEARCH_LIMIT);
    expect(entries.map((e) => e.label)).toEqual([
      "Place 10",
      "Place 9",
      "Place 8",
      "Place 7",
      "Place 6",
      "Place 5",
      "Place 4",
      "Place 3",
    ]);

    // Picking an existing entry moves it to the top without duplicating.
    entries = recordRecentSearchEntry(entries, { ...sample(5), pickedAt: "2026-10-18T01:00:00.000Z" });
    expect(entries).toHaveLength(RECENT_SEARCH_LIMIT);
    expect(entries[0]?.label).toBe("Place 5");
    expect(entries.filter((e) => e.label === "Place 5")).toHaveLength(1);

    // Same label and coordinates under a fallback key also dedupes.
    entries = recordRecentSearchEntry(entries, {
      ...sample(5),
      key: recentKeyForEndpoint(sample(5)),
      pickedAt: "2026-10-18T02:00:00.000Z",
    });
    expect(entries.filter((e) => e.label === "Place 5")).toHaveLength(1);
  });

  it("persists on device only and clears with clearAllStores", async () => {
    await recordRecentSearch(sample(1));
    await recordRecentSearch(sample(2));
    expect((await listRecentSearches()).map((e) => e.label)).toEqual(["Place 2", "Place 1"]);

    await clearAllStores();
    expect(await listRecentSearches()).toEqual([]);
  });
});
