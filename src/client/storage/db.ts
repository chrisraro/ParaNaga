"use client";

// The device database (decision D3): saved trips, saved places, trip history and the last-seen
// revision, in IndexedDB through `idb`. Nothing here is ever sent to a server. Every read goes
// through the Zod schemas in src/domain/saved: a record that fails them (an older format, a
// corrupted write) is removed and counted, so the screen can say so quietly instead of crashing.
// Writes are validated too. Without IndexedDB (blocked, private mode) reads are empty and writes
// reject with StorageUnavailableError.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  historyEntrySchema,
  parseRecords,
  pruneHistory,
  savedPlaceSchema,
  savedTripSchema,
  snapshotMetaSchema,
  type HistoryEntry,
  type SavedPlace,
  type SavedTrip,
  type SnapshotMeta,
} from "@/domain/saved/saved";

/** Same "paranaga." prefix as the Web Storage keys (STORAGE_PREFIX in device-data.ts). */
export const DEVICE_DB_NAME = "paranaga.device";
const DB_VERSION = 1;
const META_KEY = "head";

type Stores = "savedTrips" | "savedPlaces" | "history" | "snapshotMeta";
const STORES: readonly Stores[] = ["savedTrips", "savedPlaces", "history", "snapshotMeta"];

interface DeviceDb extends DBSchema {
  savedTrips: { key: string; value: unknown };
  savedPlaces: { key: string; value: unknown };
  history: { key: string; value: unknown };
  snapshotMeta: { key: string; value: unknown };
}

export class StorageUnavailableError extends Error {
  constructor() {
    super("Storage on this phone is not available.");
    this.name = "StorageUnavailableError";
  }
}

let opening: Promise<IDBPDatabase<DeviceDb> | null> | null = null;

function open(): Promise<IDBPDatabase<DeviceDb> | null> {
  if (opening) return opening;
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening = openDB<DeviceDb>(DEVICE_DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Out-of-line keys for every store: the record's own id is passed on put, so a stored
      // value never needs a particular shape to be readable (and removable) again.
      for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    },
    blocking() {
      // A newer version (another tab after an update) wants the database: let it.
      void opening?.then((db) => db?.close());
      opening = null;
    },
  }).catch(() => {
    opening = null;
    return null;
  });
  return opening;
}

async function requireDb(): Promise<IDBPDatabase<DeviceDb>> {
  const db = await open();
  if (!db) throw new StorageUnavailableError();
  return db;
}

// ---------------------------------------------------------------- change notifications

type Listener = () => void;
const listeners = new Set<Listener>();

/** Called after every write in this tab (saved screen, Save buttons stay in step). */
export function subscribeDeviceStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

// ---------------------------------------------------------------- generic helpers

export type ListResult<T> = { records: T[]; dropped: number };

type Schema<T> = { safeParse: (v: unknown) => { success: true; data: T } | { success: false } };

/** Every valid record of a store; invalid ones are deleted and counted. */
async function readAll<T>(store: Stores, schema: Schema<T>): Promise<ListResult<T>> {
  const db = await open();
  if (!db) return { records: [], dropped: 0 };
  const tx = db.transaction(store, "readonly");
  const [keys, values] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()]);
  await tx.done;
  const records: T[] = [];
  const bad: string[] = [];
  values.forEach((value, i) => {
    const parsed = parseRecords(schema, [value]);
    if (parsed.records[0] !== undefined) records.push(parsed.records[0]);
    else bad.push(keys[i]!);
  });
  if (bad.length > 0) await removeKeys(db, store, bad);
  return { records, dropped: bad.length };
}

async function removeKeys(db: IDBPDatabase<DeviceDb>, store: Stores, keys: readonly string[]): Promise<void> {
  try {
    const tx = db.transaction(store, "readwrite");
    await Promise.all([...keys.map((k) => tx.store.delete(k)), tx.done]);
  } catch {
    // Could not clean up: the records are skipped again next time.
  }
}

async function put<T extends { id: string }>(store: Stores, schema: { parse: (v: unknown) => T }, value: T): Promise<void> {
  const record = schema.parse(value);
  const db = await requireDb();
  await db.put(store, record, record.id);
  notify();
}

async function remove(store: Stores, id: string): Promise<void> {
  const db = await requireDb();
  await db.delete(store, id);
  notify();
}

const newestFirst = <T>(key: (t: T) => string) => (a: T, b: T) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0);

// ---------------------------------------------------------------- saved trips

export async function listSavedTrips(): Promise<ListResult<SavedTrip>> {
  const result = await readAll("savedTrips", savedTripSchema);
  return { ...result, records: result.records.sort(newestFirst((t) => t.savedAt)) };
}

export async function getSavedTrip(id: string): Promise<SavedTrip | null> {
  const db = await open();
  if (!db) return null;
  const parsed = savedTripSchema.safeParse(await db.get("savedTrips", id));
  return parsed.success ? parsed.data : null;
}

export const putSavedTrip = (trip: SavedTrip) => put("savedTrips", savedTripSchema, trip);
export const deleteSavedTrip = (id: string) => remove("savedTrips", id);

// ---------------------------------------------------------------- saved places

export async function listSavedPlaces(): Promise<ListResult<SavedPlace>> {
  const result = await readAll("savedPlaces", savedPlaceSchema);
  return { ...result, records: result.records.sort(newestFirst((p) => p.savedAt)) };
}

export const putSavedPlace = (place: SavedPlace) => put("savedPlaces", savedPlaceSchema, place);
export const deleteSavedPlace = (id: string) => remove("savedPlaces", id);

// ---------------------------------------------------------------- history

/** History newest first; entries past the retention period are deleted on read. */
export async function listHistory(nowMs = Date.now()): Promise<ListResult<HistoryEntry>> {
  const result = await readAll("history", historyEntrySchema);
  const { keep, expired } = pruneHistory(result.records, nowMs);
  if (expired.length > 0) {
    const db = await open();
    if (db) await removeKeys(db, "history", expired);
  }
  return { records: keep.sort(newestFirst((e) => e.at)), dropped: result.dropped };
}

export const addHistoryEntry = (entry: HistoryEntry) => put("history", historyEntrySchema, entry);

export async function countHistory(): Promise<number> {
  return (await listHistory()).records.length;
}

export async function clearHistoryStore(): Promise<void> {
  const db = await open();
  if (!db) return;
  await db.clear("history");
  notify();
}

// ---------------------------------------------------------------- snapshot meta

export async function writeSnapshotMeta(meta: SnapshotMeta): Promise<void> {
  const record = snapshotMetaSchema.parse(meta);
  const db = await open();
  if (!db) return;
  await db.put("snapshotMeta", record, META_KEY);
}

export async function readSnapshotMeta(): Promise<SnapshotMeta | null> {
  const db = await open();
  if (!db) return null;
  const parsed = snapshotMetaSchema.safeParse(await db.get("snapshotMeta", META_KEY));
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------- everything

/** Empties every store ("Clear data on this device"). */
export async function clearAllStores(): Promise<void> {
  const db = await open();
  if (!db) return;
  const tx = db.transaction([...STORES], "readwrite");
  await Promise.all([...STORES.map((s) => tx.objectStore(s).clear()), tx.done]);
  notify();
}
