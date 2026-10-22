// Driver-evidence retention purge (N7): dry run deletes nothing; commit removes rows and objects in
// one transaction per report, rolls the rows back when an object will not go, skips what the
// database no longer finds due (legal hold, concurrent run), is safe to run twice, and records
// every run. The cron route is in cron-retention-route.test.ts.
import { describe, expect, it } from "vitest";
import { MemoryStorageAdapter } from "@/server/storage/adapter";

const R1 = "aa1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a01";
const R2 = "aa1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a02";
const U1 = "aa1c1c7e-6f0a-4a39-9d62-0d0f5f2a8a03";

const text = (q: unknown): string =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? [])
    .map((c) => (typeof c === "object" && c && "value" in c ? ((c as { value: string[] }).value ?? []).join("") : "?"))
    .join("");
const flat = (q: unknown): unknown[] =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? []).flatMap((c) => (typeof c === "object" && c && "value" in c ? [] : [c]));

/** A fake database: rows exist until a committed purge removes them. */
function fakeDb(opts: { holdOn?: string[] } = {}) {
  const live = new Set([R1, R2, U1]);
  const log: string[] = [];
  const runs: unknown[][] = [];
  const asSystem = async <T,>(fn: (db: never) => Promise<T>): Promise<T> => {
    const pending: string[] = [];
    const db = {
      execute: async (q: unknown) => {
        const t = text(q);
        const p = flat(q);
        if (t.includes("priv.retention_due")) {
          return {
            rows: [
              {
                d: {
                  complaints: [R1, R2].filter((id) => live.has(id)).map((id) => ({ id, objects: [{ bucket: "evidence-private", key: `complaint_evidence/${id}.jpg` }] })),
                  uploads: live.has(U1) ? [{ id: U1, bucket: "evidence-private", key: `complaint_evidence/${U1}.jpg` }] : [],
                },
              },
            ],
          };
        }
        if (t.includes("priv.retention_purge_complaint") || t.includes("priv.retention_purge_upload")) {
          const id = String(p[0]);
          const ok = live.has(id) && !(opts.holdOn ?? []).includes(id);
          if (ok) pending.push(id);
          log.push(`purge ${id} ${ok}`);
          return { rows: [{ ok }] };
        }
        if (t.includes("priv.retention_record_run")) {
          runs.push(p);
          return { rows: [] };
        }
        throw new Error(`unexpected ${t}`);
      },
    };
    const out = await fn(db as never); // a throw here is a rollback: pending is dropped
    for (const id of pending) live.delete(id);
    return out;
  };
  return { asSystem, live, log, runs };
}

async function storageWithObjects() {
  const s = new MemoryStorageAdapter();
  for (const id of [R1, R2, U1]) await s.putObject("evidence-private", `complaint_evidence/${id}.jpg`, new Uint8Array([1, 2, 3]), "image/jpeg");
  return s;
}

const { runEvidenceRetention } = await import("@/server/complaints/retention");

describe("runEvidenceRetention", () => {
  it("dry run counts what is due and deletes nothing; the run is recorded as a dry run", async () => {
    const db = fakeDb();
    const storage = await storageWithObjects();
    const summary = await runEvidenceRetention({ dryRun: true, storage, asSystem: db.asSystem });
    expect(summary).toEqual({ dryRun: true, complaints: 2, uploads: 1, objects: 3, failed: 0 });
    expect(db.log).toEqual([]);
    expect(db.live.size).toBe(3);
    expect(await storage.headObject("evidence-private", `complaint_evidence/${R1}.jpg`)).not.toBeNull();
    expect(db.runs).toEqual([[true, 2, 1, 3, 0]]);
  });

  it("commit removes rows and objects together, and a second run finds nothing (idempotent)", async () => {
    const db = fakeDb();
    const storage = await storageWithObjects();
    expect(await runEvidenceRetention({ dryRun: false, storage, asSystem: db.asSystem })).toEqual({ dryRun: false, complaints: 2, uploads: 1, objects: 3, failed: 0 });
    expect(db.live.size).toBe(0);
    for (const id of [R1, R2, U1]) expect(await storage.headObject("evidence-private", `complaint_evidence/${id}.jpg`)).toBeNull();
    expect(await runEvidenceRetention({ dryRun: false, storage, asSystem: db.asSystem })).toEqual({ dryRun: false, complaints: 0, uploads: 0, objects: 0, failed: 0 });
    expect(db.runs).toHaveLength(2);
  });

  it("a report the database no longer finds due (legal hold set meanwhile) keeps its objects", async () => {
    const db = fakeDb({ holdOn: [R2] });
    const storage = await storageWithObjects();
    const summary = await runEvidenceRetention({ dryRun: false, storage, asSystem: db.asSystem });
    expect(summary.complaints).toBe(1);
    expect(db.live.has(R2)).toBe(true);
    expect(await storage.headObject("evidence-private", `complaint_evidence/${R2}.jpg`)).not.toBeNull();
  });

  it("an object that will not go rolls its rows back and counts as failed; the others proceed", async () => {
    const db = fakeDb();
    const storage = await storageWithObjects();
    const stuck = `complaint_evidence/${R1}.jpg`;
    const del = storage.deleteObject.bind(storage);
    storage.deleteObject = async (b: string, k: string) => (k === stuck ? false : del(b, k));
    const summary = await runEvidenceRetention({ dryRun: false, storage, asSystem: db.asSystem });
    expect(summary).toMatchObject({ complaints: 1, uploads: 1, failed: 1 });
    expect(db.live.has(R1)).toBe(true);
    expect(db.runs.at(-1)).toEqual([false, 1, 1, 2, 1]);
  });

  it("an object still present after delete (HEAD check) also rolls back", async () => {
    const db = fakeDb();
    const storage = await storageWithObjects();
    storage.deleteObject = async () => true; // claims success, deletes nothing
    const summary = await runEvidenceRetention({ dryRun: false, storage, asSystem: db.asSystem });
    expect(summary).toMatchObject({ complaints: 0, uploads: 0, failed: 3 });
    expect(db.live.size).toBe(3);
  });
});
