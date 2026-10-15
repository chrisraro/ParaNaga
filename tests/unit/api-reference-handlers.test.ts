// Search index, terminal and sources handlers with the DB context and repos mocked: parameter
// validation, the completeness guard, 404s, cache headers and read-only transactions.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiErrorSchema,
  searchIndexSchema,
  sourceListSchema,
  terminalDetailSchema,
  type TerminalDetail,
} from "@/domain/api/schemas";
import type { SearchIndexSource } from "@/domain/search/index-build";
import { buildSearchIndex } from "@/domain/search/index-build";
import { INDEX_CODE_SOURCE_CODES } from "@/domain/search/legacy-route-names";
import { realSearchSource } from "../fixtures/search-source";

const calls: { options: unknown }[] = [];
let source: SearchIndexSource | null = null;
let terminal: Omit<TerminalDetail, "revision"> | null = null;
const terminalCodes: string[] = [];
const sourceCalls: unknown[][] = [];

const revisionId = "6f9619ff-8b86-4d11-b42d-00c04fc964ff";
const revision = { revisionId, label: "r", kind: "provisional" as const, publishedAt: "2026-10-15T00:00:00.000Z" };

vi.mock("@/server/db/context", () => ({
  withRequestContext: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>, options?: unknown) => {
    calls.push({ options });
    return fn({});
  },
}));
vi.mock("@/server/repos/network-repo", () => ({ getPublishedRevision: async () => revision }));
vi.mock("@/server/repos/reference-repo", () => ({
  getSearchIndexSource: async (_db: unknown, id: string) => (source && id === revisionId ? source : null),
  getTerminalDetail: async (_db: unknown, _rev: string, code: string) => {
    terminalCodes.push(code);
    return code === "T01" ? terminal : null;
  },
  listSources: async (...args: unknown[]) => (sourceCalls.push(args.slice(1)), [
    { code: "S01", title: "Ordinance", url: null, evidenceType: "official", publishedOrEnacted: "2025-09-23", checkedOn: "2026-10-15" },
  ]),
}));

const { GET: searchIndex } = await import("@/app/api/v1/network/search-index/[revisionId]/route");
const { GET: terminalGET } = await import("@/app/api/v1/terminals/[code]/route");
const { GET: sourcesGET } = await import("@/app/api/v1/sources/route");

const base = "http://localhost/api/v1";
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as never;
const indexReq = (id: string) => searchIndex(new Request(`${base}/network/search-index/${id}`), ctx({ revisionId: id }));
const terminalReq = (code: string) => terminalGET(new Request(`${base}/terminals/${code}`), ctx({ code }));

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(apiErrorSchema.parse(await response.json()).error.code).toBe(code);
}

const real = () => ({ ...realSearchSource(), revision });

beforeEach(() => {
  calls.length = 0;
  terminalCodes.length = 0;
  source = null;
  terminal = null;
});

describe("GET /api/v1/network/search-index/:revisionId", () => {
  it("serves the published revision's index as immutable, read in a read-only transaction", async () => {
    source = real();
    const response = await indexReq(revisionId);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, s-maxage=31536000, immutable");
    expect(calls).toEqual([{ options: { readOnly: true } }]);
    const body = searchIndexSchema.parse(await response.json());
    expect(body.revision.revisionId).toBe(revisionId);
    expect(body.legacyNames.every((n) => n.mappedRouteCode === null)).toBe(true);
  });

  it("400 for a non-UUID revision id, before touching the database", async () => {
    await expectError(await indexReq("latest"), 400, "bad_request");
    expect(calls).toEqual([]);
  });

  it("404 for a revision that is not the published one", async () => {
    source = real();
    await expectError(await indexReq("11111111-1111-4111-8111-111111111111"), 404, "not_found");
  });

  it.each([
    ["no stops", (s: SearchIndexSource) => ({ ...s, stops: [] })],
    ["only blank labels", (s: SearchIndexSource) => ({ ...s, stops: s.stops.map((x) => ({ ...x, label: "" })) })],
    ["no routes", (s: SearchIndexSource) => ({ ...s, routes: [] })],
  ])("503 no-store for an incomplete read (%s)", async (_name, cut) => {
    source = cut(real());
    await expectError(await indexReq(revisionId), 503, "unavailable");
  });
});

describe("GET /api/v1/terminals/:code", () => {
  const detail: Omit<TerminalDetail, "revision"> = {
    terminal: {
      code: "T01", name: "Bicol Central Station", locationText: "Ninoy & Cory Avenue, Triangulo", modes: ["bus"],
      evidenceStatus: "official_address", notes: null, sourceCodes: ["S09"], lat: null, lng: null,
    },
    routes: [{ routeCode: "R8-A", routeName: "Loop A", basis: "legal_plan", sourceCodes: ["S01"] }],
    destinationCategories: [],
    sources: [],
  };

  it("serves a terminal with the reference cache header; lower-case codes are accepted", async () => {
    terminal = detail;
    const response = await terminalReq("t01");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, s-maxage=300, stale-while-revalidate=600");
    expect(terminalCodes).toEqual(["T01"]);
    const body = terminalDetailSchema.parse(await response.json());
    expect(body.terminal).toMatchObject({ code: "T01", lat: null, lng: null });
  });

  it.each(["T1", "T001", "X01", "T01;drop", ""])("400 for code %j before touching the database", async (code) => {
    await expectError(await terminalReq(code), 400, "bad_request");
    expect(calls).toEqual([]);
  });

  it("404 for an unknown terminal", async () => {
    await expectError(await terminalReq("T99"), 404, "not_found");
  });
});

describe("GET /api/v1/sources", () => {
  it("asks for the sources the index cites from code (S28, legacy names) as well", async () => {
    sourceCalls.length = 0;
    await sourcesGET(new Request(`${base}/sources`));
    expect(sourceCalls).toEqual([[revisionId, ["S28"]]]);
    const index = buildSearchIndex(real());
    const codeCited = [...new Set(index.legacyNames.map((n) => n.sourceCode))];
    expect([...INDEX_CODE_SOURCE_CODES]).toEqual(codeCited);
  });

  it("serves the register with the reference cache header", async () => {
    const response = await sourcesGET(new Request(`${base}/sources`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, s-maxage=300, stale-while-revalidate=600");
    expect(sourceListSchema.parse(await response.json()).sources.map((s) => s.code)).toEqual(["S01"]);
  });
});
