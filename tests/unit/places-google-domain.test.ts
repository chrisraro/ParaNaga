// Google Places cost guard, pure side (src/domain/places/google.ts): when the phone may ask
// Google, the strict request schemas, and parsing Google's answers down to what we keep.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GOOGLE_DAILY_CAP,
  GOOGLE_QUERY_MAX,
  normalizeGoogleQuery,
  rateLimitAddress,
  parseAutocomplete,
  parsePlaceLocation,
  resolveRequestSchema,
  resolveResponseSchema,
  shouldAskGoogle,
  suggestRequestSchema,
  suggestResponseSchema,
} from "@/domain/places/google";

const TOKEN = "3f2c1a4e-8b7d-4c6e-9f10-2a3b4c5d6e7f";

describe("Google Places guard (domain)", () => {
  it("caps Google at 300 calls a day and 80 characters a query", () => {
    expect(GOOGLE_DAILY_CAP).toBe(300);
    expect(GOOGLE_QUERY_MAX).toBe(80);
  });

  it("the cap is hard-coded in SQL (ops.places_take_call takes no cap) and matches the constant", () => {
    const sql = readFileSync("db/migrations/0012_places_google_guard.sql", "utf8");
    expect(sql).toContain(`v_cap constant integer := ${GOOGLE_DAILY_CAP};`);
    expect(sql).toContain("create function ops.places_take_call() returns boolean");
  });

  it("rate-limits IPv6 by its /64 prefix and IPv4 by the full address", () => {
    expect(rateLimitAddress("203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitAddress("2001:DB8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(rateLimitAddress("2001:db8:0001:0002:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(rateLimitAddress("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(rateLimitAddress("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitAddress("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(rateLimitAddress("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitAddress("unknown")).toBe("unknown");
  });

  it("normalizes a query: width-folded, trimmed, spaces collapsed, lower case", () => {
    expect(normalizeGoogleQuery("  Ｓｍ   City\tNAGA ")).toBe("sm city naga");
  });

  it("asks Google only with fewer than 3 local results and at least 3 characters", () => {
    expect(shouldAskGoogle("jollibee", 0)).toBe(true);
    expect(shouldAskGoogle("jollibee", 2)).toBe(true);
    expect(shouldAskGoogle("jollibee", 3)).toBe(false);
    expect(shouldAskGoogle("jo", 0)).toBe(false);
    expect(shouldAskGoogle("  jo   ", 0)).toBe(false);
  });

  it("accepts a 3–80 character query and a UUID session token, normalizing the query", () => {
    expect(suggestRequestSchema.parse({ query: " Bigg's  Diner ", sessionToken: TOKEN })).toEqual({ query: "bigg's diner", sessionToken: TOKEN });
    expect(suggestRequestSchema.safeParse({ query: "ab", sessionToken: TOKEN }).success).toBe(false);
    expect(suggestRequestSchema.safeParse({ query: "a".repeat(81), sessionToken: TOKEN }).success).toBe(false);
    expect(suggestRequestSchema.safeParse({ query: "abc", sessionToken: "not-a-uuid" }).success).toBe(false);
    expect(suggestRequestSchema.safeParse({ query: "abc", sessionToken: TOKEN, extra: 1 }).success).toBe(false);
  });

  it("accepts only a plain place id (no slashes, dots or query characters)", () => {
    expect(resolveRequestSchema.safeParse({ placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4", sessionToken: TOKEN }).success).toBe(true);
    for (const placeId of ["", "../places", "abc/def", "abc?key=1", "abc def", "a".repeat(301)]) {
      expect(resolveRequestSchema.safeParse({ placeId, sessionToken: TOKEN }).success, placeId).toBe(false);
    }
  });

  it("keeps only place id, title and subtitle from an autocomplete answer (at most 5)", () => {
    const answer = {
      suggestions: [
        { placePrediction: { placeId: "p1", structuredFormat: { mainText: { text: "Bigg's Diner" }, secondaryText: { text: "Magsaysay Ave, Naga" } }, types: ["restaurant"] } },
        { queryPrediction: { text: { text: "biggs near me" } } },
        { placePrediction: { placeId: "bad/id", structuredFormat: { mainText: { text: "Nope" } } } },
        ...Array.from({ length: 6 }, (_, i) => ({ placePrediction: { placeId: `q${i}`, structuredFormat: { mainText: { text: `Place ${i}` } } } })),
      ],
    };
    const parsed = parseAutocomplete(answer);
    expect(parsed?.[0]).toEqual({ placeId: "p1", title: "Bigg's Diner", subtitle: "Magsaysay Ave, Naga" });
    expect(parsed?.[1]).toEqual({ placeId: "q0", title: "Place 0", subtitle: null });
    expect(parsed).toHaveLength(5);
    expect(parseAutocomplete({})).toEqual([]);
    expect(parseAutocomplete("nonsense")).toBeNull();
  });

  it("reads a location from a details answer, or null", () => {
    expect(parsePlaceLocation({ location: { latitude: 13.62, longitude: 123.19 } })).toEqual({ lat: 13.62, lng: 123.19 });
    expect(parsePlaceLocation({ location: { latitude: 200, longitude: 0 } })).toBeNull();
    expect(parsePlaceLocation({})).toBeNull();
  });

  it("answers with a status the screen can always fall back on", () => {
    for (const status of ["capped", "rate_limited", "unavailable"]) {
      expect(suggestResponseSchema.parse({ status })).toEqual({ status });
      expect(resolveResponseSchema.parse({ status })).toEqual({ status });
    }
    expect(resolveResponseSchema.parse({ status: "outside" })).toEqual({ status: "outside" });
    expect(suggestResponseSchema.parse({ status: "ok", suggestions: [] })).toEqual({ status: "ok", suggestions: [] });
  });
});
