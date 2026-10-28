"use client";

// The device database (decision D3): saved trips, saved places, trip history and the last-seen
// revision, in IndexedDB through `idb`. Nothing here is ever sent to a server.
//
// Every record is written with a format version `v` (RECORD_FORMAT) and every read goes through
// decodeStored + the Zod schemas in src/domain/saved. A record that fails (corrupted, or written by
// a newer build in another tab) is SKIPPED AND KEPT, never deleted or rewritten by a read; every
// read counts them again, so every screen reports the same numbers. Only damaged records (not
// newer-format ones) can be removed, and only when the person asks (removeUnreadable). Writes are
// validated too. Store-shape changes go through
// `upgrade`, keyed by DB_VERSION (STORE_MIGRATIONS).
//
// Without IndexedDB (blocked, private mode, a failed open) reads and writes reject with
// StorageUnavailableError, so screens show an honest "unavailable" state instead of "nothing
// saved". Writes notify this tab's subscribers and other tabs (BroadcastChannel).

import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from "idb";
import {
  RECORD_FORMAT,
  decodeStored,
  historyEntrySchema,
  pruneHistory,
  savedPlaceSchema,
  savedTripSchema,
  snapshotMetaSchema,
  type HistoryEntry,
  type SavedPlace,
  type SavedTrip,
  type SnapshotMeta,
} from "@/domain/saved/saved";
import {
  recordRecentSearchEntry,
  recentSearchesSchema,
  type RecentSearchEntry,
} from "@/domain/search/recents";

/** Same "paranaga." prefix as the Web Storage keys (STORAGE_PREFIX in device-data.ts). */
export const DEVICE_DB_NAME = "paranaga.device";
const DB_VERSION = 1;
const META_KEY = "head";
const RECENT_SEARCHES_KEY = "recentSearches";
const CHANNEL = "paranaga.device";

type Stores = "savedTrips" | "savedPlaces" | "history" | "snapshotMeta";
const STORES: readonly Stores[] = ["savedTrips", "savedPlaces", "history", "snapshotMeta"];
type RecordStore = Exclude<Stores, "snapshotMeta">;

interface DeviceDb extends DBSchema {
  savedTrips: { key: string; value: unknown };
  savedPlaces: { key: string; value: unknown };
  history: { key: string; value: unknown };
  snapshotMeta: { key: string; value: unknown };
}

type UpgradeTx = IDBPTransaction<DeviceDb, StoreNames<DeviceDb>[], "versionchange">;

/**
 * One step per database version: STORE_MIGRATIONS[n] brings a database at version n - 1 to n.
 * Version 1 creates the stores (out-of-line keys, so a stored value never needs a particular shape
 * to be found by key again). A later task that changes stores or record formats bumps DB_VERSION
 * and adds a step here (record contents also migrate on read through decodeStored).
 */
const STORE_MIGRATIONS: Record<number, (db: IDBPDatabase<DeviceDb>, tx: UpgradeTx) => void> = {
  1: (db) => {
    for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
  },
};

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
    upgrade(db, oldVersion, newVersion, tx) {
      for (let v = oldVersion + 1; v <= (newVersion ?? DB_VERSION); v++) STORE_MIGRATIONS[v]?.(db, tx);
    },
    blocking() {
      // A newer version (another tab after an update) wants the database: let it.
      void opening?.then((db) => db?.close());
      opening = null;
    },
    terminated() {
      // Closed abnormally (site data cleared, eviction): open afresh next time.
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

/** Tests only: drop the cached connection. */
export async function resetDeviceDbConnection(): Promise<void> {
  const db = await opening;
  db?.close();
  opening = null;
}

// ---------------------------------------------------------------- change notifications

type Listener = () => void;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;

function ensureChannel(): void {
  if (channel || typeof BroadcastChannel === "undefined") return;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = () => notifyLocal();
}

/** Called after every write in this tab and in other tabs of this site. */
export function subscribeDeviceStore(listener: Listener): () => void {
  ensureChannel();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyLocal(): void {
  for (const listener of [...listeners]) listener();
}

function notify(): void {
  notifyLocal();
  ensureChannel();
  channel?.postMessage("changed");
}

// ---------------------------------------------------------------- generic helpers

/**
 * `dropped`: records of this store that could not be read; they stay stored, untouched.
 * `unreadable`: those of them that are damaged (fail validation), which the person may remove with
 * removeUnreadable; the rest are from a newer ParaNaga (another tab) and are never offered for removal.
 */
export type ListResult<T> = { records: T[]; dropped: number; unreadable: number };

type Schema<T> = { safeParse: (v: unknown) => { success: true; data: T } | { success: false } };

async function readAll<T>(store: RecordStore, schema: Schema<T>): Promise<ListResult<T>> {
  const db = await requireDb();
  const tx = db.transaction(store, "readonly");
  const values = await tx.store.getAll();
  await tx.done;
  const records: T[] = [];
  let dropped = 0;
  let unreadable = 0;
  for (const value of values) {
    const decoded = decodeStored(value, schema);
    if (decoded.ok) records.push(decoded.record);
    else {
      dropped += 1;
      if (decoded.reason === "invalid") unreadable += 1;
    }
  }
  return { records, dropped, unreadable };
}

const SCHEMAS: Record<RecordStore, Schema<unknown>> = { savedTrips: savedTripSchema, savedPlaces: savedPlaceSchema, history: historyEntrySchema };

/**
 * Deletes this store's damaged records (those failing validation), in one transaction that
 * re-checks every record, so a record written meanwhile or one from a newer ParaNaga is never
 * removed. Returns how many were removed.
 */
export async function removeUnreadable(store: RecordStore): Promise<number> {
  const db = await requireDb();
  const tx = db.transaction(store, "readwrite");
  const [keys, values] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()]);
  const bad = keys.filter((_, i) => {
    const decoded = decodeStored(values[i], SCHEMAS[store]);
    return !decoded.ok && decoded.reason === "invalid";
  });
  await Promise.all([...bad.map((k) => tx.store.delete(k)), tx.done]);
  if (bad.length > 0) notify();
  return bad.length;
}

// Deletes not yet sent to the account (so a sync cannot bring the item back). Kept in the
// snapshotMeta store (no schema change); a save of the same id cancels its pending delete.
const PENDING_DELETES_KEY = "pendingDeletes";
export type PendingDeletes = { places: string[]; trips: string[] };
const PENDING_KIND = { savedPlaces: "places", savedTrips: "trips" } as const;

function pendingOf(value: unknown): PendingDeletes {
  const v = (value ?? {}) as Partial<PendingDeletes>;
  const strings = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : []);
  return { places: strings(v.places), trips: strings(v.trips) };
}

async function editPending(tx: IDBPTransaction<DeviceDb, StoreNames<DeviceDb>[], "readwrite">, edit: (p: PendingDeletes) => void) {
  const meta = tx.objectStore("snapshotMeta");
  const pending = pendingOf(await meta.get(PENDING_DELETES_KEY));
  edit(pending);
  await meta.put({ ...pending, v: RECORD_FORMAT }, PENDING_DELETES_KEY);
}

export async function listPendingDeletes(): Promise<PendingDeletes> {
  const db = await requireDb();
  return pendingOf(await db.get("snapshotMeta", PENDING_DELETES_KEY));
}

/** The account has these deletes: forget them (an id saved again meanwhile was already cancelled). */
export async function clearPendingDeletes(kind: keyof PendingDeletes, ids: string[]): Promise<void> {
  const db = await requireDb();
  const tx = db.transaction(["snapshotMeta"], "readwrite");
  await Promise.all([editPending(tx, (p) => void (p[kind] = p[kind].filter((id) => !ids.includes(id)))), tx.done]);
}

async function put<T extends { id: string }>(store: RecordStore, schema: { parse: (v: unknown) => T }, value: T): Promise<void> {
  const record = schema.parse(value);
  const db = await requireDb();
  const tx = db.transaction([store, "snapshotMeta"], "readwrite");
  const kind = store === "history" ? null : PENDING_KIND[store];
  await Promise.all([
    tx.objectStore(store).put({ ...record, v: RECORD_FORMAT }, record.id),
    kind ? editPending(tx, (p) => void (p[kind] = p[kind].filter((id) => id !== record.id))) : null,
    tx.done,
  ]);
  notify();
}

async function remove(store: RecordStore, id: string): Promise<void> {
  const db = await requireDb();
  const tx = db.transaction([store, "snapshotMeta"], "readwrite");
  const kind = store === "history" ? null : PENDING_KIND[store];
  await Promise.all([
    tx.objectStore(store).delete(id),
    // Bounded: a guest who never signs in never flushes this list.
    kind ? editPending(tx, (p) => void (p[kind] = [...p[kind].filter((x) => x !== id), id].slice(-500))) : null,
    tx.done,
  ]);
  notify();
}

const newestFirst = <T>(key: (t: T) => string) => (a: T, b: T) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0);

// ---------------------------------------------------------------- saved trips

export async function listSavedTrips(): Promise<ListResult<SavedTrip>> {
  const result = await readAll("savedTrips", savedTripSchema);
  return { ...result, records: result.records.sort(newestFirst((t) => t.savedAt)) };
}

export async function getSavedTrip(id: string): Promise<SavedTrip | null> {
  const db = await requireDb();
  const decoded = decodeStored(await db.get("savedTrips", id), savedTripSchema);
  return decoded.ok ? decoded.record : null;
}

export const putSavedTrip = (trip: SavedTrip) => put("savedTrips", savedTripSchema, trip);
export const deleteSavedTrip = (id: string) => remove("savedTrips", id);

/**
 * "Update saved copy": the new card replaces the old one in ONE transaction, so a failure leaves
 * exactly the old copy (never both, never neither).
 */
export async function replaceSavedTrip(oldId: string, trip: SavedTrip): Promise<void> {
  const record = savedTripSchema.parse(trip);
  const db = await requireDb();
  const tx = db.transaction(["savedTrips", "snapshotMeta"], "readwrite");
  const trips = tx.objectStore("savedTrips");
  const writes: Promise<unknown>[] = [trips.put({ ...record, v: RECORD_FORMAT }, record.id)];
  writes.push(editPending(tx, (p) => void (p.trips = [...p.trips.filter((x) => x !== record.id && x !== oldId), ...(oldId !== record.id ? [oldId] : [])])));
  if (oldId !== record.id) writes.push(trips.delete(oldId));
  await Promise.all([...writes, tx.done]);
  notify();
}

// ---------------------------------------------------------------- saved places

export async function listSavedPlaces(): Promise<ListResult<SavedPlace>> {
  const result = await readAll("savedPlaces", savedPlaceSchema);
  return { ...result, records: result.records.sort(newestFirst((p) => p.savedAt)) };
}

export const putSavedPlace = (place: SavedPlace) => put("savedPlaces", savedPlaceSchema, place);
export const deleteSavedPlace = (id: string) => remove("savedPlaces", id);

// ---------------------------------------------------------------- history

/**
 * History newest first. Valid entries past the retention period are deleted on read (that is the
 * 90-day promise); unreadable entries are kept like any other skipped record.
 */
export async function listHistory(nowMs = Date.now()): Promise<ListResult<HistoryEntry>> {
  const result = await readAll("history", historyEntrySchema);
  const { keep, expired } = pruneHistory(result.records, nowMs);
  if (expired.length > 0) {
    const db = await requireDb();
    const tx = db.transaction("history", "readwrite");
    await Promise.all([...expired.map((k) => tx.store.delete(k)), tx.done]);
  }
  return { ...result, records: keep.sort(newestFirst((e) => e.at)) };
}

export const addHistoryEntry = (entry: HistoryEntry) => put("history", historyEntrySchema, entry);

export async function countHistory(): Promise<number> {
  return (await listHistory()).records.length;
}

export async function clearHistoryStore(): Promise<void> {
  const db = await open();
  if (!db) return; // nothing stored that we could reach
  await db.clear("history");
  notify();
}

// ---------------------------------------------------------------- snapshot meta (best effort)

export async function writeSnapshotMeta(meta: SnapshotMeta): Promise<void> {
  const record = snapshotMetaSchema.parse(meta);
  const db = await open();
  if (!db) return;
  await db.put("snapshotMeta", { ...record, v: RECORD_FORMAT }, META_KEY);
}

export async function readSnapshotMeta(): Promise<SnapshotMeta | null> {
  const db = await open();
  if (!db) return null;
  const decoded = decodeStored(await db.get("snapshotMeta", META_KEY), snapshotMetaSchema);
  return decoded.ok ? decoded.record : null;
}

// ---------------------------------------------------------------- recent searches (best effort, device-only)

export async function listRecentSearches(): Promise<RecentSearchEntry[]> {
  const db = await open();
  if (!db) return [];
  const decoded = decodeStored(await db.get("snapshotMeta", RECENT_SEARCHES_KEY), recentSearchesSchema);
  return decoded.ok ? decoded.record.entries : [];
}

export async function recordRecentSearch(entry: Omit<RecentSearchEntry, "pickedAt"> & { pickedAt?: string }): Promise<void> {
  const db = await open();
  if (!db) return;
  const current = await listRecentSearches();
  const entries = recordRecentSearchEntry(current, {
    ...entry,
    pickedAt: entry.pickedAt ?? new Date().toISOString(),
  });
  await db.put("snapshotMeta", { entries, v: RECORD_FORMAT }, RECENT_SEARCHES_KEY);
  notify();
}

// ---------------------------------------------------------------- everything

/** Empties every store ("Clear data on this device"), skipped records included. */
export async function clearAllStores(): Promise<void> {
  const db = await open();
  if (!db) return;
  const tx = db.transaction([...STORES], "readwrite");
  await Promise.all([...STORES.map((s) => tx.objectStore(s).clear()), tx.done]);
  notify();
}
