// Lines and walk-graph handlers (Task 7) without a database: parameter validation, the
// published-revision-only rule (404), the incomplete-read guard (503, never cached), Zod-validated
// output, immutable cache headers and the walk graph's verbatim text with ETag = sha256 (304 on
// If-None-Match). The DB context and repo are mocked.
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiErrorSchema,
  LINES_ATTRIBUTION,
  linesSchema,
  OSM_COPYRIGHT_URL,
  PATH_LABEL,
  UNTRACED_MESSAGE,
  type Line,
  type Lines,
} from "@/domain/api/schemas";
import { encodePolyline } from "@/domain/geo/polyline";
import { fleetSummary } from "@/domain/modes/fleet";
import type { LinesRead, WalkGraphRead } from "@/server/repos/network-repo";

const calls: { options: unknown }[] = [];
let linesRead: LinesRead = { status: "not_published" };
let walkRead: WalkGraphRead = { status: "not_published" };

vi.mock("@/server/db/context", () => ({
  withRequestContext: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>, options?: unknown) => {
    calls.push({ options });
    return fn({});
  },
}));
vi.mock("@/server/repos/network-repo", () => ({ getLines: async () => linesRead, getWalkGraph: async () => walkRead }));

const { GET: linesGET } = await import("@/app/api/v1/network/lines/[revisionId]/route");
const { GET: walkGET } = await import("@/app/api/v1/network/walk-graph/[revisionId]/route");

const revisionId = "6f9619ff-8b86-4d11-b42d-00c04fc964ff";
const revision = { revisionId, label: "modes-lines-2026-10-16", kind: "provisional" as const, publishedAt: "2026-10-16T00:00:00.000Z" };
const ctx = (id: string) => ({ params: Promise.resolve({ revisionId: id }) }) as never;
const lines = (id = revisionId, init?: RequestInit) => linesGET(new Request(`http://localhost/api/v1/network/lines/${id}`, init), ctx(id));
const walk = (id = revisionId, init?: RequestInit) => walkGET(new Request(`http://localhost/api/v1/network/walk-graph/${id}`, init), ctx(id));

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(apiErrorSchema.parse(await response.json()).error.code).toBe(code);
}

const variant = {
  variantId: "22222222-2222-4222-8222-222222222222", routeId: "33333333-3333-4333-8333-333333333333",
  routeCode: "R1", routeName: "Centro–San Isidro", variantName: null, mode: "jeepney" as const,
  direction: "inbound" as const, kind: "permanent" as const,
};
const fleet = fleetSummary([], "jeepney");
const line: Line = {
  ...variant, serviceStatus: "legal_plan" as const, planning: "none" as const, fleet, colourKey: fleet.colourKey,
  status: "ok" as const, flagReason: null,
  encoded: encodePolyline([{ lat: 13.6233869, lng: 123.1846726 }, { lat: 13.6244338, lng: 123.1861778 }]),
  lengthM: 201.4, label: PATH_LABEL, roadSource: "OSMR-2026-10-16", attribution: LINES_ATTRIBUTION,
  segments: [{ fromM: 10, toM: 82, lengthM: 72, reason: "oneway_conflict" as const, streets: [{ name: "abella st", m: 72 }], against: ["general luna st"] }],
  quality: { listedStreets: 7, matchedStreets: 7, unmatchedStreets: [], offListShare: 0.031, gateOffListShare: 0.031, terminalAccessM: 0 },
};
const body: Lines = {
  revision, label: PATH_LABEL, attribution: LINES_ATTRIBUTION, attributionUrl: OSM_COPYRIGHT_URL, licence: "ODbL 1.0",
  roadSources: ["OSMR-2026-10-16"], lines: [line],
  untraced: [{
    ...variant, variantId: "44444444-4444-4444-8444-444444444444", routeCode: "TRI-VISTODA", routeName: "VISTODA",
    variantName: "Langon – Ateneo de Naga", mode: "tricycle", direction: "branch", reason: "anchor_unresolved",
    message: UNTRACED_MESSAGE, quality: { listedStreets: 0, matchedStreets: 0, unmatchedStreets: [], anchorsUnresolved: ["Langon"] },
  }],
};

// A tiny valid format-v1 payload (two nodes, one edge), as stored: verbatim text.
const payload = JSON.stringify({
  v: 1, roadSource: "OSMR-2026-10-16", bbox: [1362000, 12318000, 1362100, 12318100],
  nodes: [1362000, 12318000, 50, 50], edges: [0, 1, 80, 0], geom: [],
});
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("GET /api/v1/network/lines/:revisionId", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("rejects a non-UUID revision id with 400 before reading", async () => {
    await expectError(await lines("x"), 400, "bad_request");
    expect(calls).toEqual([]);
  });

  it("404 for a revision that is not the published one, and for one without paths", async () => {
    linesRead = { status: "not_published" };
    await expectError(await lines(), 404, "not_found");
    linesRead = { status: "none" };
    await expectError(await lines(), 404, "not_found");
  });

  it("503 no-store when a member variant has no shape row (never cached)", async () => {
    linesRead = { status: "incomplete", missing: 2 };
    await expectError(await lines(), 503, "unavailable");
  });

  it("serves the validated lines as immutable, read in a read-only transaction", async () => {
    linesRead = { status: "ok", body };
    const response = await lines();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, s-maxage=31536000, immutable");
    expect(calls).toEqual([{ options: { readOnly: true } }]);
    const parsed = linesSchema.parse(await response.json());
    expect(parsed.lines[0]).toMatchObject({ label: PATH_LABEL, roadSource: "OSMR-2026-10-16", attribution: LINES_ATTRIBUTION });
    expect(parsed.untraced[0]).toMatchObject({ reason: "anchor_unresolved", message: "Path could not be traced from the street list" });
  });

  it("never sends a path that leaves the Naga map bounds, or a flagged path without its reason (500)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const outside = encodePolyline([{ lat: 14.55, lng: 120.98 }, { lat: 14.56, lng: 120.99 }]);
    linesRead = { status: "ok", body: { ...body, lines: [{ ...line, encoded: outside }] } };
    await expectError(await lines(), 500, "internal");
    linesRead = { status: "ok", body: { ...body, lines: [{ ...line, status: "flagged" }] } };
    await expectError(await lines(), 500, "internal");
    errors.mockRestore();
  });
});

describe("GET /api/v1/network/walk-graph/:revisionId", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("rejects a non-UUID revision id with 400 before reading", async () => {
    await expectError(await walk("1 or 1=1"), 400, "bad_request");
    expect(calls).toEqual([]);
  });

  it("404 for a revision that is not the published one, and for one without a walk graph", async () => {
    walkRead = { status: "not_published" };
    await expectError(await walk(), 404, "not_found");
    walkRead = { status: "none" };
    await expectError(await walk(), 404, "not_found");
  });

  it("serves the stored text verbatim as application/json, immutable, with ETag = sha256", async () => {
    walkRead = { status: "ok", payload, sha256: sha(payload), bytes: Buffer.byteLength(payload) };
    const response = await walk();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("public, s-maxage=31536000, immutable");
    expect(response.headers.get("etag")).toBe(`"${sha(payload)}"`);
    expect(await response.text()).toBe(payload);
    expect(calls).toEqual([{ options: { readOnly: true } }]);
  });

  it("answers a matching If-None-Match with 304 and no body", async () => {
    walkRead = { status: "ok", payload, sha256: sha(payload), bytes: Buffer.byteLength(payload) };
    const response = await walk(revisionId, { headers: { "if-none-match": `W/"other", "${sha(payload)}"` } });
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(`"${sha(payload)}"`);
    expect(await response.text()).toBe("");
  });

  it.each([
    ["a sha256 that does not match the text", { payload, sha256: "0".repeat(64), bytes: Buffer.byteLength(payload) }],
    ["a size that does not match the text", { payload, sha256: sha(payload), bytes: 1 }],
    ["text that is not JSON", { payload: "{", sha256: sha("{"), bytes: 1 }],
    ["JSON that is not format v1", { payload: '{"v":2}', sha256: sha('{"v":2}'), bytes: 7 }],
  ])("503 no-store for %s", async (_name, stored) => {
    walkRead = { status: "ok", ...stored };
    await expectError(await walk(), 503, "unavailable");
  });
});
