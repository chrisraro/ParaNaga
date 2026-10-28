// /api/v1/admin/{stops,reconciliation,imports} (N5b): the role guard (404 for everyone but admin
// and transport reviewer, before any database call), strict bodies, the definer function each
// action calls with the page's expected version, the refusal → HTTP mapping, a dry run that writes
// nothing, and a commit that plans the file again on the server.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { planAdminImport } from "@/domain/admin/imports";
import { importCommitResultSchema, importDryRunSchema, reconciliationSchema, stopActionResultSchema, stopListSchema } from "@/domain/admin/stops";
import { apiErrorSchema } from "@/domain/api/schemas";

const STOP = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a01";
const OTHER = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a02";
const VER = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a03";
const NEW_VER = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a04";
const DRAFT = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a05";
const BATCH = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8b01";
const MAP = "1f0HedvouLfPzGTte38TdqNM4pYBICG4";
const KML = readFileSync("Data_Sets/naga_mapped_stops_source.kml", "utf8");

const state = vi.hoisted(() => ({
  user: null as { id: string; name: string; roles: string[] } | null,
  calls: [] as string[],
  params: new Map<string, unknown[]>(),
  fail: null as { code: string; message: string } | null,
  baseline: null as unknown,
}));

const text = (q: unknown): string =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? [])
    .map((c) => (typeof c === "object" && c && "value" in c ? ((c as { value: string[] }).value ?? []).join("") : "?"))
    .join("");
const flat = (q: unknown): unknown[] =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? []).flatMap((c) =>
    typeof c === "object" && c && "value" in c ? [] : typeof c === "object" && c && "queryChunks" in c ? flat(c) : [c],
  );

vi.mock("@/server/auth/session", () => ({
  getCurrentUser: async () => state.user,
  getAuthSession: async () => (state.user ? { userId: state.user.id, sessionId: "sess-1", email: null, authenticatedAt: new Date() } : null),
}));

const STOP_ROW = {
  stopPointId: STOP, versionId: VER, name: "Plaza Rizal", aliases: [], status: "candidate", layer: "Loop Service A", code: "A1",
  labelRaw: "Plaza Rizal", lat: 13.6233869, lng: 123.1846726, curbSide: null, boardingAllowed: null, alightingAllowed: null,
  navigationApproved: false, editNote: null, isSynthetic: false, sequences: ["R8-A"],
  pins: [{ layer: "Loop Service A", code: "A1", label: "Plaza Rizal", description: "Plaza Rizal", lat: "13.62338690", lng: "123.18467260" }],
  evidence: [{ id: OTHER, kind: "document", claim: "legal_designation", note: null, observedOn: null, sourceCode: "S12", hasMedia: false, createdAt: "2026-10-22 10:00:00.5+08" }],
};

vi.mock("@/server/db/context", () => ({
  withRequestContext: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
    fn({
      execute: async (q: unknown) => {
        const key = text(q).match(/ops\.take_token|(?:transit|ingest)\.admin_\w+/)?.[0] ?? "other";
        state.calls.push(key);
        state.params.set(key, flat(q));
        if (key === "ops.take_token") return { rows: [{ ok: true }] };
        if (state.fail && key !== "ingest.admin_import_baseline") throw Object.assign(new Error("Failed query"), { cause: state.fail });
        switch (key) {
          case "transit.admin_stops":
            return { rows: [{ d: { revision: { id: DRAFT, label: "draft-x", kind: "provisional", status: "draft" }, stops: [STOP_ROW] } }] };
          case "transit.admin_reconciliation":
            return {
              rows: [{
                d: {
                  revision: { id: DRAFT, label: "draft-x", kind: "provisional", status: "draft" },
                  pairs: [{
                    a: { stopPointId: STOP, versionId: VER, name: "Plaza Rizal", status: "candidate", layer: "Loop Service A", code: "A1", lat: 13.62, lng: 123.18 },
                    b: { stopPointId: OTHER, versionId: NEW_VER, name: "Plaza Rizal", status: "candidate", layer: "Loop Service C", code: "A1", lat: 13.62, lng: 123.18 },
                    distanceM: "0.0",
                  }],
                  pins: [
                    { stopPointId: STOP, versionId: VER, name: "Plaza Rizal", status: "candidate", pinLayer: "Loop Service A", pinCode: "A1", pinLabel: "Plaza Rizal", distanceM: 0 },
                    { stopPointId: OTHER, versionId: NEW_VER, name: "Moved", status: "candidate", pinLayer: "Loop Service C", pinCode: "C3", pinLabel: "Moved", distanceM: 80.4 },
                  ],
                  decisions: [],
                },
              }],
            };
          case "ingest.admin_import_baseline":
            return { rows: [{ b: state.baseline }] };
          case "ingest.admin_import_batches":
            return { rows: [{ b: [] }] };
          case "ingest.admin_import_commit":
            return { rows: [{ r: { outcome: "unchanged", batchId: BATCH, snapshotVersion: `mymaps:${MAP}:2026-10-15`, revisionId: null, counts: { unchanged: 128 } } }] };
          case "transit.admin_reconcile":
            return { rows: [{ r: { decision: "keep_separate", keptVersionId: null, retiredVersionId: null } }] };
          default:
            if (key.startsWith("transit.admin_")) return { rows: [{ v: NEW_VER }] };
            return { rows: [] };
        }
      },
    }),
}));

const h = await import("@/server/admin/handlers");

const post = (url: string, body: unknown = {}, type = "application/json") =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": type }, body: JSON.stringify(body) });
const get = (url: string) => new Request(`http://localhost${url}`);
const stopParams = (id = STOP) => Promise.resolve({ id });
const errorCode = async (res: Response) => apiErrorSchema.parse(await res.json()).error.code;
const db = () => state.calls.filter((c) => c !== "ops.take_token" && c !== "other");

const ADMIN = { id: "u-admin", name: "A", roles: ["commuter", "admin"] };
const REVIEWER = { id: "u-rev", name: "R", roles: ["commuter", "transport_reviewer"] };
const upload = { format: "kml", fileName: "naga_mapped_stops_source.kml", text: KML, retrievedOn: "2026-10-20" };

function baselineFromKml() {
  const plan = planAdminImport(upload as never, { batchId: BATCH, snapshotVersion: `mymaps:${MAP}:2026-10-15`, mapId: MAP, features: [] });
  return {
    batchId: BATCH, snapshotVersion: `mymaps:${MAP}:2026-10-15`, mapId: MAP, finishedAt: "2026-10-15 09:02:00+08",
    features: plan.features.map((f) => ({ sourceIdentity: f.sourceIdentity, contentHash: f.contentHash, layer: f.sourceLayer, code: f.sourceCodeRaw, label: f.labelRaw, lat: String(f.lat), lng: String(f.lon) })),
  };
}

beforeEach(() => {
  state.user = null;
  state.calls = [];
  state.params.clear();
  state.fail = null;
  state.baseline = baselineFromKml();
});

describe("role guard", () => {
  it("404 before any database call for guests, commuters, moderators, complaint reviewers and suspended accounts", async () => {
    for (const user of [null, { id: "c", name: "C", roles: ["commuter"] }, { id: "m", name: "M", roles: ["commuter", "community_moderator"] }, { id: "k", name: "K", roles: ["complaint_reviewer"] }, { id: "s", name: "S", roles: [] }]) {
      state.user = user;
      for (const res of [
        await h.getStops(get("/api/v1/admin/stops")),
        await h.postStopAction(post(`/api/v1/admin/stops/${STOP}`, { action: "retire", expectedVersionId: VER, reason: "Not a stop." }), stopParams()),
        await h.getReconciliation(get("/api/v1/admin/reconciliation")),
        await h.postReconciliation(post("/api/v1/admin/reconciliation", {})),
        await h.getImports(get("/api/v1/admin/imports")),
        await h.postImportDryRun(post("/api/v1/admin/imports/dry-run", upload)),
        await h.postImportCommit(post("/api/v1/admin/imports/commit", { ...upload, expectedBaselineBatchId: BATCH })),
      ]) {
        expect(res.status, JSON.stringify(user)).toBe(404);
        expect(res.headers.get("cache-control")).toBe("private, no-store");
      }
    }
    expect(db()).toEqual([]);
  });
});

describe("stops", () => {
  it("lists the open draft's stops (private, editable) with ISO times and numeric pins", async () => {
    state.user = REVIEWER;
    const res = await h.getStops(get("/api/v1/admin/stops"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = stopListSchema.parse(await res.json());
    expect(body.editable).toBe(true);
    expect(body.stops[0]!.pins[0]!.lat).toBeCloseTo(13.6233869, 6);
    expect(body.stops[0]!.evidence[0]!.createdAt).toBe("2026-10-22T02:00:00.500Z");
  });

  it("each action calls its definer function with the stop and the expected version", async () => {
    state.user = ADMIN;
    const cases: [unknown, string, unknown[]][] = [
      [{ action: "promote", expectedVersionId: VER, status: "documentary" }, "transit.admin_promote_stop", [STOP, VER, "documentary", null]],
      [{ action: "evidence", expectedVersionId: VER, kind: "document", claim: "legal_designation", sourceCode: "S12" }, "transit.admin_attach_stop_evidence", [STOP, VER, "document", "legal_designation", null, null, "S12", null]],
      [{ action: "retire", expectedVersionId: VER, reason: "Private driveway." }, "transit.admin_retire_stop", [STOP, VER, "Private driveway."]],
      [{ action: "relocate", expectedVersionId: VER, lat: 13.6244, lng: 123.1862, reason: "Wrong corner." }, "transit.admin_relocate_stop", [STOP, VER, 13.6244, 123.1862, "Wrong corner."]],
      [{ action: "edit", expectedVersionId: VER, changes: { name: "Plaza Rizal" } }, "transit.admin_edit_stop", [STOP, VER, JSON.stringify({ name: "Plaza Rizal" })]],
    ];
    for (const [body, fn, args] of cases) {
      state.calls = [];
      const res = await h.postStopAction(post(`/api/v1/admin/stops/${STOP}`, body), stopParams());
      expect(res.status, fn).toBe(200);
      expect(stopActionResultSchema.parse(await res.json())).toEqual({ stopPointId: STOP, versionId: NEW_VER });
      expect(db()).toEqual([fn]);
      expect(state.params.get(fn)).toEqual(args);
    }
  });

  it("400 on a bad body, 404 on a bad id, and never calls the database for either", async () => {
    state.user = ADMIN;
    expect((await h.postStopAction(post(`/api/v1/admin/stops/${STOP}`, { action: "promote", status: "published", expectedVersionId: VER }), stopParams())).status).toBe(400);
    expect((await h.postStopAction(post(`/api/v1/admin/stops/${STOP}`, { action: "retire", expectedVersionId: VER, reason: "Not a stop.", extra: 1 }), stopParams())).status).toBe(400);
    expect((await h.postStopAction(post(`/api/v1/admin/stops/${STOP}`, {}, "text/plain"), stopParams())).status).toBe(400);
    expect((await h.postStopAction(post("/api/v1/admin/stops/x", {}), stopParams("x"))).status).toBe(404);
    expect(db()).toEqual([]);
  });

  it("maps refusals: stale version or a rule 409, unknown stop 404, bad input 400, role 404", async () => {
    state.user = ADMIN;
    const cases: [{ code: string; message: string }, number, string][] = [
      [{ code: "55000", message: "this stop changed since the page was loaded; reload and try again" }, 409, "conflict"],
      [{ code: "55000", message: "promotion to documentary needs evidence for legal_designation on this stop first" }, 409, "conflict"],
      [{ code: "55000", message: "no draft revision is open; create one under Revisions first" }, 409, "conflict"],
      [{ code: "22023", message: "unknown stop" }, 404, "not_found"],
      [{ code: "22023", message: "the new position is the same as the current one" }, 400, "bad_request"],
      [{ code: "42501", message: "forbidden" }, 404, "not_found"],
    ];
    for (const [fail, status, code] of cases) {
      state.fail = fail;
      const res = await h.postStopAction(post(`/api/v1/admin/stops/${STOP}`, { action: "promote", expectedVersionId: VER, status: "documentary" }), stopParams());
      expect(res.status, fail.message).toBe(status);
      expect(await errorCode(res)).toBe(code);
    }
  });
});

describe("reconciliation", () => {
  it("adds the name similarity to pairs and keeps only disagreeing pins", async () => {
    state.user = ADMIN;
    const body = reconciliationSchema.parse(await (await h.getReconciliation(get("/api/v1/admin/reconciliation"))).json());
    expect(body.pairs[0]).toMatchObject({ distanceM: 0, similarNames: true });
    expect(body.mismatches).toEqual([expect.objectContaining({ stopPointId: OTHER, far: true, nameDiffers: false })]);
  });

  it("records a decision with both expected versions", async () => {
    state.user = REVIEWER;
    const res = await h.postReconciliation(
      post("/api/v1/admin/reconciliation", { a: { stopPointId: STOP, expectedVersionId: VER }, b: { stopPointId: OTHER, expectedVersionId: NEW_VER }, decision: "keep_separate" }),
    );
    expect(res.status).toBe(200);
    expect(state.params.get("transit.admin_reconcile")).toEqual([STOP, VER, OTHER, NEW_VER, "keep_separate", null, null]);
    expect((await h.postReconciliation(post("/api/v1/admin/reconciliation", { a: { stopPointId: STOP, expectedVersionId: VER }, b: { stopPointId: OTHER, expectedVersionId: NEW_VER }, decision: "link" }))).status).toBe(400);
  });
});

describe("imports", () => {
  it("dry run: reads only the baseline, writes nothing, answers the diff (AC-1: 128 unchanged)", async () => {
    state.user = ADMIN;
    const res = await h.postImportDryRun(post("/api/v1/admin/imports/dry-run", upload));
    expect(res.status).toBe(200);
    const body = importDryRunSchema.parse(await res.json());
    expect(body.changes).toEqual({ added: 0, changed: 0, unchanged: 128, missing: 0 });
    expect(body.canCommit).toBe(true);
    expect(db()).toEqual(["ingest.admin_import_baseline"]);
  });

  it("commit: plans the file again on the server and sends every raw feature to ingest.admin_import_commit", async () => {
    state.user = REVIEWER;
    const res = await h.postImportCommit(post("/api/v1/admin/imports/commit", { ...upload, expectedBaselineBatchId: BATCH }));
    expect(res.status).toBe(200);
    expect(importCommitResultSchema.parse(await res.json())).toMatchObject({ outcome: "unchanged", counts: { unchanged: 128 } });
    expect(db()).toEqual(["ingest.admin_import_baseline", "ingest.admin_import_commit"]);
    const plan = JSON.parse(String(state.params.get("ingest.admin_import_commit")![0]));
    expect(plan).toMatchObject({ mapId: MAP, snapshotVersion: `mymaps:${MAP}:2026-10-20`, expectedBaselineBatchId: BATCH });
    expect(plan.features).toHaveLength(128);
  });

  it("commit: 409 when another import landed since the dry run, 400 when the file has problems; nothing committed", async () => {
    state.user = ADMIN;
    const stale = await h.postImportCommit(post("/api/v1/admin/imports/commit", { ...upload, expectedBaselineBatchId: OTHER }));
    expect(stale.status).toBe(409);
    const bad = await h.postImportCommit(post("/api/v1/admin/imports/commit", { ...upload, text: "<kml/>", expectedBaselineBatchId: BATCH }));
    expect(bad.status).toBe(400);
    expect(db()).not.toContain("ingest.admin_import_commit");
  });

  it("refuses a body without the export date or with an unknown format", async () => {
    state.user = ADMIN;
    expect((await h.postImportDryRun(post("/api/v1/admin/imports/dry-run", { ...upload, retrievedOn: undefined }))).status).toBe(400);
    expect((await h.postImportDryRun(post("/api/v1/admin/imports/dry-run", { ...upload, format: "geojson" }))).status).toBe(400);
    expect(db()).toEqual([]);
  });
});
