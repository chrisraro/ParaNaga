// Route handler behaviour that needs no database: parameter validation, the error envelope,
// request ids, and that failures log neither coordinates nor bbox values.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiErrorSchema } from "@/domain/api/schemas";
import { GET as head } from "@/app/api/v1/network/head/route";
import { GET as snapshot } from "@/app/api/v1/network/snapshot/[revisionId]/route";
import { GET as stops } from "@/app/api/v1/stops/route";
import { GET as stop } from "@/app/api/v1/stops/[id]/route";
import { GET as route } from "@/app/api/v1/routes/[code]/route";

const base = "http://localhost/api/v1";
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) }) as never;

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = apiErrorSchema.parse(await response.json());
  expect(body.error.code).toBe(code);
  expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
  return body;
}

describe("public API handlers without a database", () => {
  const saved = process.env.PARANAGA_DATABASE_URL;
  let errors: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.PARANAGA_DATABASE_URL;
    errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    if (saved !== undefined) process.env.PARANAGA_DATABASE_URL = saved;
    errors.mockRestore();
  });

  it.each([
    ["missing", ""],
    ["malformed", "?bbox=1,2,3"],
    ["outside Naga", "?bbox=120.98,14.55,121.02,14.6"],
    ["inverted", "?bbox=123.20,13.61,123.17,13.64"],
  ])("stops?bbox rejects %s with 400 before touching the database", async (_name, query) => {
    const body = await expectError(await stops(new Request(`${base}/stops${query}`)), 400, "bad_request");
    expect(body.error.message).not.toMatch(/120\.98|14\.55|123\.2/);
    expect(errors).not.toHaveBeenCalled();
  });

  it("snapshot rejects a non-UUID revision id with 400", async () => {
    await expectError(await snapshot(new Request(`${base}/network/snapshot/x`), ctx({ revisionId: "x" })), 400, "bad_request");
  });

  it("stops/:id rejects a non-UUID id with 400", async () => {
    await expectError(await stop(new Request(`${base}/stops/1`), ctx({ id: "1 or 1=1" })), 400, "bad_request");
  });

  it("routes/:code rejects an invalid code with 400", async () => {
    await expectError(await route(new Request(`${base}/routes/x`), ctx({ code: "R1;drop" })), 400, "bad_request");
  });

  it("keeps a safe client request id and replaces an unsafe one", async () => {
    const kept = await stops(new Request(`${base}/stops`, { headers: { "x-request-id": "req_123-abc" } }));
    expect(kept.headers.get("x-request-id")).toBe("req_123-abc");
    const replaced = await stops(new Request(`${base}/stops`, { headers: { "x-request-id": "<script>" } }));
    expect(replaced.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a server failure returns the internal envelope and logs no request values", async () => {
    const response = await stops(new Request(`${base}/stops?bbox=123.17,13.61,123.20,13.64`));
    await expectError(response, 500, "internal");
    await expectError(await head(new Request(`${base}/network/head`)), 500, "internal");
    const logged = errors.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(logged).toContain('"event":"api_error"');
    expect(logged).not.toMatch(/123\.17|13\.61|bbox|postgres/);
  });
});
