// POST /api/v1/me/saved-trips (F1): a trip on a revision this database does not have is left out and
// named; the rest of the batch is stored. The mock database refuses an unknown revision (23503), as
// the foreign key does.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { planResponseSchema } from "@/domain/api/plan";
import { buildSavedTrip } from "@/domain/saved/saved";
import { PROVISIONAL_PLAN } from "../e2e/fixtures/plan-responses";

const state = vi.hoisted(() => ({ revisions: [] as string[], stored: [] as string[] }));
vi.mock("@/server/auth/authorize", () => ({ authorize: async () => ({ id: "user-1", name: "A", roles: ["commuter"] }) }));
vi.mock("@/server/ratelimit/rate-limiter", () => ({ RATE_LIMITS: {}, checkRateLimit: async () => true }));
vi.mock("@/server/db/context", () => ({
  withRequestContext: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
    fn({
      execute: async (q: { queryChunks: unknown[] }) => {
        const isSql = (c: unknown): c is { value: string[] } => typeof c === "object" && c !== null && Array.isArray((c as { value?: unknown }).value);
        const text = q.queryChunks.map((c) => (isSql(c) ? c.value.join("") : "?")).join("");
        if (text.includes("from transit.revision")) return { rows: state.revisions.map((id) => ({ id })) };
        if (text.includes("insert into core.saved_trip")) {
          const params = q.queryChunks.filter((c) => typeof c === "string") as string[];
          if (!state.revisions.includes(params[2]!.toLowerCase())) throw Object.assign(new Error("fk"), { code: "23503" });
          state.stored.push(params[1]!);
          return { rows: [] };
        }
        throw new Error(`unexpected query: ${text}`);
      },
    }),
}));

const { POST } = await import("@/app/api/v1/me/saved-trips/route");

const KNOWN = "ab1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a01";
const UNKNOWN = "ab1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a02";
const plan = planResponseSchema.parse(PROVISIONAL_PLAN);
const trip = (id: string, revisionId: string) => ({
  ...buildSavedTrip({
    id,
    savedAt: "2026-10-16T02:00:00.000Z",
    data: plan,
    option: plan.plan.options[0]!,
    start: { label: "Plaza Rizal", point: { lat: 13.6224, lng: 123.1838 } },
    destination: { label: "Avenue Square", point: { lat: 13.6305, lng: 123.1912 } },
  }),
  revisionId,
});
const post = (trips: unknown[]) =>
  POST(new Request("http://localhost/api/v1/me/saved-trips", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trips }) }));

beforeEach(() => {
  state.revisions = [KNOWN];
  state.stored = [];
});

describe("POST /api/v1/me/saved-trips", () => {
  it("leaves out only the trip with an unknown revision", async () => {
    const res = await post([trip("a", KNOWN), trip("b", UNKNOWN), trip("c", KNOWN.toUpperCase())]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, count: 2, rejected: ["b"] });
    expect(state.stored).toEqual(["a", "c"]);
  });

  it("an empty batch is fine", async () => {
    expect(await (await post([])).json()).toEqual({ ok: true, count: 0, rejected: [] });
  });
});
