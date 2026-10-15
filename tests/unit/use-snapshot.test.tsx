// @vitest-environment jsdom
// The shared network snapshot (Task 12): one load per page, the revision this phone saw last when
// the head cannot be read, and a re-check on reconnect that picks up a newly published revision
// (which re-runs the saved-trip check through useTripRevalidation).
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSnapshotForTests, useSnapshot } from "@/client/network/use-snapshot";
import { clearAllStores, writeSnapshotMeta } from "@/client/storage/db";
import snapshot from "../e2e/fixtures/network/snapshot.json";

const NEXT = { ...snapshot.revision, revisionId: "11111111-2222-4333-8444-555555555555", label: "next" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let head: unknown = snapshot.revision;
let headFails = false;
const fetchMock = vi.fn(async (url: string) => {
  if (url === "/api/v1/network/head") {
    if (headFails) throw new TypeError("Failed to fetch");
    return json(head);
  }
  if (url === `/api/v1/network/snapshot/${snapshot.revision.revisionId}`) return json(snapshot);
  if (url === `/api/v1/network/snapshot/${NEXT.revisionId}`) return json({ ...snapshot, revision: NEXT });
  return json({}, 404);
});

beforeEach(async () => {
  resetSnapshotForTests();
  await clearAllStores();
  head = snapshot.revision;
  headFails = false;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useSnapshot", () => {
  it("loads the snapshot of the published revision once for every consumer", async () => {
    const a = renderHook(() => useSnapshot());
    const b = renderHook(() => useSnapshot());
    await waitFor(() => expect(a.result.current.status).toBe("ready"));
    expect(b.result.current.snapshot?.revision.revisionId).toBe(snapshot.revision.revisionId);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/snapshot/"))).toHaveLength(1);
  });

  it("without the head, uses the revision this phone saw last (served from the worker's cache)", async () => {
    headFails = true;
    await writeSnapshotMeta({ revisionId: snapshot.revision.revisionId, publishedAt: snapshot.revision.publishedAt });
    const { result } = renderHook(() => useSnapshot());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.snapshot?.revision.revisionId).toBe(snapshot.revision.revisionId);
  });

  it("on reconnect checks the head again and switches to a newly published revision", async () => {
    const { result } = renderHook(() => useSnapshot());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    head = NEXT;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(result.current.snapshot?.revision.revisionId).toBe(NEXT.revisionId));
  });

  it("disabled: reads only, never loads", async () => {
    const { result } = renderHook(() => useSnapshot(false));
    await act(async () => undefined);
    expect(result.current.status).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
