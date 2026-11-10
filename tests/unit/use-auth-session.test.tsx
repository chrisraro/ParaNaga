// @vitest-environment jsdom
// Audit 2026-11-10: a session check that got no answer (offline, a 5xx) is "unknown", never
// "signed out": a signed-in person must not be told to sign in because the check failed, and a
// failed sign-out must not read as signed out.
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const signOut = vi.hoisted(() => vi.fn());
vi.mock("@/client/auth/client", () => ({ getAuthClient: async () => ({ signOut }) }));

const { useAuthSession } = await import("@/client/auth/use-auth-session");

const USER = { id: "u1", name: "Ana", roles: [] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
/** GET /api/v1/me answers, in order (the last one repeats). */
function me(...answers: (() => Response | Promise<Response>)[]) {
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async () => answers[Math.min(n++, answers.length - 1)]!()));
}
const offline = () => Promise.reject(new TypeError("Failed to fetch"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  signOut.mockReset();
});

describe("useAuthSession", () => {
  it("starts as checking, then signed in or signed out from the answer", async () => {
    me(() => json({ user: USER }));
    const a = renderHook(() => useAuthSession());
    expect(a.result.current).toMatchObject({ status: "checking", loading: true, user: null });
    await waitFor(() => expect(a.result.current).toMatchObject({ status: "signedIn", loading: false, user: USER }));

    me(() => json({ user: null }));
    const b = renderHook(() => useAuthSession());
    await waitFor(() => expect(b.result.current).toMatchObject({ status: "signedOut", loading: false, user: null }));
  });

  it("a failed check (offline or a server error) is unknown, not signed out; refresh() checks again", async () => {
    me(offline);
    const a = renderHook(() => useAuthSession());
    await waitFor(() => expect(a.result.current.status).toBe("unknown"));
    expect(a.result.current.loading).toBe(false);

    me(() => json({}, 503), () => json({ user: USER }));
    const b = renderHook(() => useAuthSession());
    await waitFor(() => expect(b.result.current.status).toBe("unknown"));
    await act(() => b.result.current.refresh());
    expect(b.result.current).toMatchObject({ status: "signedIn", user: USER });
  });

  it("a sign-out that fails, with no answer from the re-check, keeps showing the signed-in person", async () => {
    me(() => json({ user: USER }), offline);
    signOut.mockRejectedValue(new Error("network"));
    const hook = renderHook(() => useAuthSession());
    await waitFor(() => expect(hook.result.current.status).toBe("signedIn"));
    await act(() => hook.result.current.signOut());
    expect(hook.result.current).toMatchObject({ status: "signedIn", user: USER });
  });

  it("a sign-out that worked reads as signed out even when the re-check gets no answer", async () => {
    me(() => json({ user: USER }), offline);
    signOut.mockResolvedValue({ data: { success: true }, error: null });
    const hook = renderHook(() => useAuthSession());
    await waitFor(() => expect(hook.result.current.status).toBe("signedIn"));
    await act(() => hook.result.current.signOut());
    expect(hook.result.current).toMatchObject({ status: "signedOut", user: null });
  });
});
