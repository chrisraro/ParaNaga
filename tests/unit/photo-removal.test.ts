// Photos of deleted and taken-down posts: the storage half (src/server/community/photo-removal.ts).
// The rule itself (migration 0036) is tested on a Neon branch: tests/integration/photo-removal-rls.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const P1 = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a11";
const P2 = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a12";
const CLAIM = "2026-11-24T12:00:00.123456+00:00";
const state = vi.hoisted(() => ({
  due: [] as { id: string; action: string }[],
  targets: new Map<string, unknown>(),
  users: [] as unknown[],
  listed: [] as unknown[][],
  log: [] as string[],
  finished: [] as unknown[][],
}));

vi.mock("@/server/env", () => ({ serverEnv: () => ({ STORAGE_BUCKET_PUBLIC: "public-media" }) }));
vi.mock("@/server/db/context", () => ({
  withRequestContext: (ctx: { userId: unknown }, fn: (db: unknown) => Promise<unknown>) => {
    state.users.push(ctx.userId);
    return fn({
      execute: async (q: { queryChunks: unknown[] }) => {
        const isText = (c: unknown) => typeof c === "object" && c !== null && "value" in c;
        const text = q.queryChunks.map((c) => (isText(c) ? (c as { value: string[] }).value.join("") : "?")).join("");
        const params = q.queryChunks.filter((c) => !isText(c));
        if (text.includes("photo_removal_due")) {
          state.listed.push(params);
          return { rows: state.due };
        }
        if (text.includes("photo_removal_begin")) {
          state.log.push(`begin ${String(params[0])}`);
          return { rows: [{ r: state.targets.get(String(params[0])) ?? null }] };
        }
        state.finished.push(params);
        return { rows: [{ r: true }] };
      },
    });
  },
}));

const { MemoryStorageAdapter, setTestStorage } = await import("@/server/storage/adapter");
const { runPhotoRemoval, syncPublicPhotos } = await import("@/server/community/photo-removal");

let storage: InstanceType<typeof MemoryStorageAdapter>;
const has = async (bucket: string, key: string) => (await storage.headObject(bucket, key)) !== null;
const run = (purge: boolean) => runPhotoRemoval({ purge, storage });

beforeEach(async () => {
  state.due = [];
  state.targets.clear();
  state.users = [];
  state.listed = [];
  state.log = [];
  state.finished = [];
  storage = new MemoryStorageAdapter();
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  for (const k of ["a", "b"]) for (const bucket of ["evidence-private", "public-media"]) await storage.putObject(bucket, k, new Uint8Array([1]), "image/jpeg");
  state.targets.set(P1, { claim: CLAIM, bucket: "evidence-private", key: "a", publicBucket: "public-media" });
  state.targets.set(P2, { claim: CLAIM, bucket: "evidence-private", key: "b", publicBucket: null });
});

describe("photo removal", () => {
  it("remove deletes only the public copy, also for a photo that no longer names it, and finishes with the exact claim", async () => {
    state.due = [{ id: P1, action: "remove" }, { id: P2, action: "remove" }];
    expect(await run(false)).toEqual({ done: 2, failed: 0 });
    for (const k of ["a", "b"]) {
      expect(await has("public-media", k)).toBe(false);
      expect(await has("evidence-private", k)).toBe(true);
    }
    expect(state.listed).toEqual([[50, false]]);
    expect(state.finished).toEqual([[P1, "remove", CLAIM], [P2, "remove", CLAIM]]);
    expect(state.users.every((u) => u === null)).toBe(true);
  });

  it("purge deletes both objects before it finishes", async () => {
    state.due = [{ id: P1, action: "purge" }];
    expect(await run(true)).toEqual({ done: 1, failed: 0 });
    expect((await has("public-media", "a")) || (await has("evidence-private", "a"))).toBe(false);
    expect(state.finished).toEqual([[P1, "purge", CLAIM]]);
  });

  it("restore copies the original back", async () => {
    await storage.deleteObject("public-media", "b");
    state.due = [{ id: P2, action: "restore" }];
    expect(await run(false)).toEqual({ done: 1, failed: 0 });
    expect(await has("public-media", "b")).toBe(true);
  });

  it("an object that stays, or a check with no answer, is never finished; the others proceed", async () => {
    state.due = [{ id: P1, action: "purge" }, { id: P2, action: "remove" }];
    const head = storage.headObject.bind(storage);
    storage.headObject = async (b, k) => {
      if (k === "a") throw new Error("timed out");
      return head(b, k);
    };
    expect(await run(true)).toEqual({ done: 1, failed: 1 });
    expect(state.finished).toEqual([[P2, "remove", CLAIM]]);
    expect(await storage.getObject("evidence-private", "a")).not.toBeNull();
  });

  it("no longer due: storage is not touched", async () => {
    state.due = [{ id: P1, action: "purge" }];
    state.targets.clear();
    expect(await run(true)).toEqual({ done: 0, failed: 0 });
    expect(await has("public-media", "a")).toBe(true);
    expect(state.finished).toEqual([]);
  });

  it("never deletes the original as if it were the public copy", async () => {
    state.due = [{ id: P1, action: "remove" }];
    state.targets.set(P1, { claim: CLAIM, bucket: "public-media", key: "a", publicBucket: "public-media" });
    expect(await run(false)).toEqual({ done: 0, failed: 1 });
    expect(await has("public-media", "a")).toBe(true);
  });

  it("without a configured object store it refuses before anything is marked", async () => {
    setTestStorage(storage);
    state.due = [{ id: P1, action: "purge" }];
    await expect(runPhotoRemoval({ purge: true })).rejects.toThrow("not configured");
    expect(state.users).toEqual([]);
    setTestStorage(null);
  });

  it("starts nothing new after a minute", async () => {
    state.due = [{ id: P1, action: "remove" }, { id: P2, action: "remove" }];
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    await runPhotoRemoval({ purge: false, storage, onItem: async () => void (now += 61_000) });
    expect(state.log).toEqual([`begin ${P1}`]);
  });

  it("the sync after a decision never throws, even outside a request", () => {
    expect(() => syncPublicPhotos()).not.toThrow();
  });
});
