// Fix batch A (audit 2026-10-28): media confirm and upload hardening.
//  - complaint evidence: the stored object is the buffer that passed the checks, not a server-side
//    copy of the (re-PUTtable) quarantine key; the recorded hash describes the stored bytes
//  - a retried confirm that loses the promote never deletes the file a verified row points to
//  - presigned PUT signs content-type and content-length; getObject refuses an oversized body
//  - the orphan sweep deletes the quarantine object, then rejects the row
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobHandler } from "@/server/jobs/types";

const SLOT_ID = "6f1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a11";
const USER = "user-owner";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x02]);
const HTML = new TextEncoder().encode("<html><script>x</script></html>");

const state = vi.hoisted(() => ({
  promoteResults: [] as boolean[],
  promoted: [] as unknown[][],
  rejected: [] as string[],
  orphans: [] as { id: string; bucket: string; object_key: string }[],
  handlers: new Map<string, unknown>(),
  enqueued: [] as { kind: string; key: string | undefined }[],
}));

const text = (q: unknown): string =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? [])
    .map((c) => (typeof c === "object" && c && "value" in c ? ((c as { value: string[] }).value ?? []).join("") : "?"))
    .join("");
const params = (q: unknown): unknown[] =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? []).filter((c) => !(typeof c === "object" && c && "value" in c));

vi.mock("@/server/env", () => ({
  serverEnv: () => ({ STORAGE_BUCKET_EVIDENCE: "evidence-private", CRON_SECRET: "cron-secret" }),
}));
vi.mock("@/server/jobs/worker", () => ({
  registerJobHandler: (kind: string, handler: unknown) => state.handlers.set(kind, handler),
  enqueueJob: async (_db: unknown, kind: string, _payload: unknown, options: { idempotencyKey?: string } = {}) => {
    state.enqueued.push({ kind, key: options.idempotencyKey });
    return "job-1";
  },
  runJobBatch: async () => ({ claimed: 0, succeeded: 0, failed: 0, retried: 0 }),
}));
vi.mock("@/server/db/context", () => ({
  withRequestContext: async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) =>
    fn({
      execute: async (q: unknown) => {
        const t = text(q);
        if (t.includes("from core.media_object")) {
          return {
            rows: [{ id: SLOT_ID, bucket: "quarantine", object_key: `quarantine/complaint_evidence/2026/${SLOT_ID}`, expected_bytes: 1024, owner_id: USER, purpose: "complaint_evidence", status: "slot" }],
          };
        }
        if (t.includes("verify_and_promote_media")) {
          state.promoted.push(params(q));
          return { rows: [{ ok: state.promoteResults.shift() ?? true }] };
        }
        if (t.includes("find_orphan_media_slots")) return { rows: state.orphans };
        if (t.includes("reject_media")) {
          state.rejected.push(String(params(q)[0]));
          return { rows: [{ reject_media: true }] };
        }
        throw new Error(`unexpected query: ${t}`);
      },
    }),
}));

const { MemoryStorageAdapter, S3StorageAdapter, setTestStorage } = await import("@/server/storage/adapter");
const { confirmMediaSlot } = await import("@/server/media/service");
const { registerDefaultJobHandlers } = await import("@/server/jobs/handlers");
const { GET: cronJobs } = await import("@/app/api/cron/jobs/route");

const QKEY = `quarantine/complaint_evidence/2026/${SLOT_ID}`;
let storage: InstanceType<typeof MemoryStorageAdapter>;

beforeEach(() => {
  state.promoteResults = [];
  state.promoted = [];
  state.rejected = [];
  state.orphans = [];
  state.enqueued = [];
  storage = new MemoryStorageAdapter();
  setTestStorage(storage);
});

describe("complaint evidence confirm", () => {
  it("stores the bytes that passed the check, even if quarantine is re-PUT after the read", async () => {
    await storage.putObject("quarantine", QKEY, JPEG, "image/jpeg");
    const realGet = storage.getObject.bind(storage);
    vi.spyOn(storage, "getObject").mockImplementation(async (b, k) => {
      const bytes = await realGet(b, k);
      // The attacker's loop swaps the quarantine object right after the server read it.
      await storage.putObject("quarantine", QKEY, HTML, "text/html");
      return bytes;
    });

    const res = await confirmMediaSlot(USER, SLOT_ID);
    const stored = await storage.headObject(res.bucket, res.objectKey);
    const bytes = await realGet(res.bucket, res.objectKey);
    expect(bytes).toEqual(JPEG);
    expect(stored?.mime).toBe("image/jpeg");
    expect(res.sha256).toBe(createHash("sha256").update(JPEG).digest("hex"));
    expect(res.sha256).toBe(createHash("sha256").update(bytes!).digest("hex"));
  });

  it("a retried confirm that loses the promote does not delete the verified row's file", async () => {
    state.promoteResults = [true, false];
    await storage.putObject("quarantine", QKEY, JPEG, "image/jpeg");
    const first = await confirmMediaSlot(USER, SLOT_ID);
    // The retry read the quarantine object before the first request deleted it.
    await storage.putObject("quarantine", QKEY, JPEG, "image/jpeg");
    await expect(confirmMediaSlot(USER, SLOT_ID)).rejects.toMatchObject({ kind: "not_found" });

    expect(await storage.getObject(first.bucket, first.objectKey)).toEqual(JPEG);
    // Each attempt writes its own key, so the loser never overwrote the winner's object either.
    expect(state.promoted[1]?.[2]).not.toBe(state.promoted[0]?.[2]);
  });

  it("a storage that does not answer fails the confirm (retryable) and keeps the slot", async () => {
    await storage.putObject("quarantine", QKEY, JPEG, "image/jpeg");
    vi.spyOn(storage, "headObject").mockRejectedValue(new Error("timed out"));
    await expect(confirmMediaSlot(USER, SLOT_ID)).rejects.toMatchObject({ kind: "failed" });
    expect(state.rejected).toEqual([]);
    expect(await storage.getObject("quarantine", QKEY)).toEqual(JPEG);
  });

  it("reads the quarantine object with the slot's size cap", async () => {
    await storage.putObject("quarantine", QKEY, JPEG, "image/jpeg");
    const get = vi.spyOn(storage, "getObject");
    await confirmMediaSlot(USER, SLOT_ID);
    expect(get).toHaveBeenCalledWith("quarantine", QKEY, 1024);
  });
});

describe("S3 adapter limits", () => {
  const s3 = new S3StorageAdapter("https://storage.example", "AKID", "secret");

  it("signs content-type and content-length into the presigned PUT", async () => {
    const up = await s3.createPresignedUpload("quarantine", "k/1", 2048, "image/jpeg", 300);
    const u = new URL(up.url);
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(up.headers).toEqual({ "Content-Type": "image/jpeg" });
  });

  it.each([
    ["headObject", 5_000, () => s3.headObject("b", "k")],
    ["deleteObject", 5_000, () => s3.deleteObject("b", "k")],
    ["getObject", 30_000, () => s3.getObject("b", "k")],
    ["copyObject", 30_000, () => s3.copyObject("b", "k", "b2", "k")],
    ["putObject", 30_000, () => s3.putObject("b", "k", JPEG, "image/jpeg")],
  ] as const)("%s gives up after %i ms", async (name, ms, call) => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    try {
      const out = await call().catch(() => "threw");
      expect(timeout).toHaveBeenCalledExactlyOnceWith(ms);
      expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBe(timeout.mock.results[0]?.value);
      // Never read as done or gone: HEAD throws, the others report failure.
      expect(out).toBe(name === "headObject" ? "threw" : name === "getObject" ? null : false);
    } finally {
      fetchSpy.mockRestore();
      timeout.mockRestore();
    }
  });

  it("HEAD: missing is null, a server error throws", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      for (const status of [404, 403]) {
        fetchSpy.mockResolvedValueOnce(new Response(null, { status }));
        expect(await s3.headObject("b", "k")).toBeNull();
      }
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 503 }));
      await expect(s3.headObject("b", "k")).rejects.toThrow("503");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("refuses a body larger than the cap before buffering it", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(8));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-length": "999999999" }),
      arrayBuffer,
    } as unknown as Response);
    try {
      expect(await s3.getObject("quarantine", "k/1", 1024)).toBeNull();
      expect(arrayBuffer).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("orphan media sweep", () => {
  it("deletes the quarantine object, then rejects the row; a failed delete leaves the row for the next run", async () => {
    registerDefaultJobHandlers();
    const sweep = state.handlers.get("sweep_orphan_media") as JobHandler;
    await storage.putObject("quarantine", "q/a", JPEG, "image/jpeg");
    await storage.putObject("quarantine", "q/b", JPEG, "image/jpeg");
    state.orphans = [
      { id: "a", bucket: "quarantine", object_key: "q/a" },
      { id: "b", bucket: "quarantine", object_key: "q/b" },
    ];
    const realDelete = storage.deleteObject.bind(storage);
    vi.spyOn(storage, "deleteObject").mockImplementation(async (b, k) => (k === "q/b" ? false : realDelete(b, k)));

    await sweep({} as never, async () => true);

    expect(await storage.headObject("quarantine", "q/a")).toBeNull();
    expect(state.rejected).toEqual(["a"]);
  });
});

describe("cron jobs route", () => {
  it("queues the orphan sweep and the rate-limit purge (fixed keys) on every authorized run, never cached", async () => {
    const res = await cronJobs(new Request("http://localhost/api/cron/jobs", { headers: { authorization: "Bearer cron-secret" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(state.enqueued).toEqual([
      { kind: "sweep_orphan_media", key: "sweep_orphan_media" },
      { kind: "retention_purge", key: "retention_purge" },
    ]);
    // Every queued kind has a handler, and nothing registers the old empty stub.
    expect([...state.handlers.keys()].sort()).toEqual(["retention_purge", "sweep_orphan_media"]);

    const denied = await cronJobs(new Request("http://localhost/api/cron/jobs"));
    expect(denied.status).toBe(401);
    expect(state.enqueued).toHaveLength(2);
  });
});

describe("0028 media confirm hardening migration", () => {
  // Statements only: line comments removed, so prose never satisfies a rule.
  const SQL = readFileSync(path.resolve("db/migrations/0028_media_confirm_hardening.sql"), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/--[^\n]*/g, "");
  const fn = (name: string) => {
    const m = new RegExp(`create or replace function core\\.${name}\\([\\s\\S]*?\\$\\$;`).exec(SQL);
    if (!m) throw new Error(`function ${name} not found`);
    return m[0];
  };

  it.each(["verify_and_promote_media", "reject_media"])("%s locks the row, answers by rows changed, keeps search_path and grants", (name) => {
    const body = fn(name);
    expect(body).toMatch(/from core\.media_object\s+where id = p_slot_id\s+for update;/);
    expect(body).toMatch(/return found;\s*end;/);
    expect(body).not.toMatch(/return true;/);
    expect(body).toContain("set search_path = pg_catalog, core, pg_temp");
    expect(body).toContain("errcode = '42501'");
    expect(SQL).toMatch(new RegExp(`revoke execute on function core\\.${name}\\([^)]*\\) from public;`));
    expect(SQL).toMatch(new RegExp(`grant execute on function core\\.${name}\\([^)]*\\) to paranaga_app;`));
    expect(SQL).toMatch(new RegExp(`alter function core\\.${name}\\([^)]*\\) owner to paranaga_definer;`));
  });

  it("returns the schema create right it borrowed", () => {
    expect(SQL.trim().endsWith("revoke create on schema core from paranaga_definer;")).toBe(true);
  });
});
