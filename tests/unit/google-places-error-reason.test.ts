import { afterEach, describe, expect, it, vi } from "vitest";
import { googleAutocomplete } from "@/server/places/google-places";

const FAKE_KEY = "AIzaSyFAKEFAKEFAKEFAKEFAKEFAKE1234567";

function envelope(reason: string, message: string) {
  return {
    error: {
      code: 403,
      status: "PERMISSION_DENIED",
      message,
      details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, domain: "googleapis.com", metadata: { service: "places.googleapis.com", consumer: "projects/123" } }],
    },
  };
}

function logged(spy: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  const line = spy.mock.calls.map((c) => String(c[0])).find((l: string) => l.includes("google_places_error"));
  return JSON.parse(line ?? "{}") as Record<string, unknown>;
}

afterEach(() => vi.restoreAllMocks());

describe("google error reason logging", () => {
  it.each(["SERVICE_DISABLED", "API_KEY_SERVICE_BLOCKED"])("logs %s and never the key", async (reason) => {
    const message = `Blocked for key=${FAKE_KEY} and ${FAKE_KEY} (project 123). key=abc123&x=1`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(envelope(reason, message)), { status: 403 })));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await googleAutocomplete(FAKE_KEY, "sm naga", "tok")).toBeNull();

    const entry = logged(spy);
    expect(entry).toMatchObject({ event: "google_places_error", status: 403, googleStatus: "PERMISSION_DENIED", googleCode: 403 });
    expect(entry.reasons).toEqual(expect.arrayContaining([reason, "googleapis.com", "places.googleapis.com"]));
    const raw = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(raw).not.toContain(FAKE_KEY);
    expect(raw).not.toContain("abc123");
  });

  it("survives an unreadable body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>nope</html>", { status: 403 })));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await googleAutocomplete(FAKE_KEY, "x", "t")).toBeNull();
    expect(logged(spy)).toMatchObject({ event: "google_places_error", status: 403 });
  });
});
