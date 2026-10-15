"use client";

// The running guidance session (Task 10), kept in this tab's sessionStorage so a reload resumes
// the same step (never a new tab: sessionStorage is per tab). Two keys, both "paranaga." prefixed
// so "Clear data on this device" removes them:
//   paranaga.guidance       the session (src/domain/guidance/session.ts, Zod-checked on the way
//                           back in, dropped after 6 h)
//   paranaga.guidance.trip  the trip as a saved-trip card (labels, points, revision), for
//                           "Save this trip" on Arrive and to put the trip back in the options
// Both are removed the moment the session ends. Coordinates never leave the device.
//
// A tiny external store (useSyncExternalStore): the server snapshot is null, the client reads
// sessionStorage once, lazily.

import { savedTripSchema, type SavedTrip } from "@/domain/saved/saved";
import {
  GUIDANCE_SESSION_KEY,
  parseSession,
  reduceSession,
  serializeSession,
  type GuidanceEvent,
  type GuidanceSession,
} from "@/domain/guidance/session";

export const GUIDANCE_TRIP_KEY = `${GUIDANCE_SESSION_KEY}.trip`;

export type GuidanceState = { session: GuidanceSession; card: SavedTrip };

// undefined: not read yet.
let state: GuidanceState | null | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function removeKeys(): void {
  const s = storage();
  try {
    s?.removeItem(GUIDANCE_SESSION_KEY);
    s?.removeItem(GUIDANCE_TRIP_KEY);
  } catch {
    // Storage blocked: nothing of ours is in it.
  }
}

function write(next: GuidanceState): void {
  try {
    storage()?.setItem(GUIDANCE_SESSION_KEY, serializeSession(next.session));
    storage()?.setItem(GUIDANCE_TRIP_KEY, JSON.stringify(next.card));
  } catch {
    // Full or blocked: guidance still runs, it just won't survive a reload.
  }
}

function load(now: number): GuidanceState | null {
  const s = storage();
  if (!s) return null;
  let rawSession: string | null = null;
  let rawCard: string | null = null;
  try {
    rawSession = s.getItem(GUIDANCE_SESSION_KEY);
    rawCard = s.getItem(GUIDANCE_TRIP_KEY);
  } catch {
    return null;
  }
  if (rawSession === null && rawCard === null) return null;
  const session = parseSession(rawSession, now);
  let card: SavedTrip | null = null;
  try {
    const parsed = savedTripSchema.safeParse(rawCard === null ? null : JSON.parse(rawCard));
    card = parsed.success ? parsed.data : null;
  } catch {
    card = null;
  }
  // Ended sessions are never kept; anything unreadable, too old or half-written is dropped.
  if (!session || !card || session.status === "ended" || card.option.id !== session.trip.option.id) {
    removeKeys();
    return null;
  }
  return { session, card };
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeGuidance(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getGuidanceSnapshot(): GuidanceState | null {
  if (state === undefined) state = load(Date.now());
  return state;
}

export function getGuidanceServerSnapshot(): GuidanceState | null {
  return null;
}

/** Starts a session (replacing any other). */
export function beginGuidance(session: GuidanceSession, card: SavedTrip): void {
  state = { session, card };
  write(state);
  emit();
}

/**
 * Applies an event; returns the session after it (the same object when nothing changed). An
 * ended session is forgotten at once, storage included.
 */
export function applyGuidanceEvent(event: GuidanceEvent): GuidanceSession | null {
  const current = getGuidanceSnapshot();
  if (!current) return null;
  const next = reduceSession(current.session, event);
  if (next === current.session) return next;
  if (next.status === "ended") {
    state = null;
    removeKeys();
  } else {
    state = { session: next, card: current.card };
    write(state);
  }
  emit();
  return next;
}

/** Forgets the session (after "Clear data on this device" removed the keys). */
export function forgetGuidance(): void {
  if (state === null) return;
  state = null;
  removeKeys();
  emit();
}

/** Tests only: the next read goes back to sessionStorage. */
export function resetGuidanceStoreForTests(): void {
  state = undefined;
  listeners.clear();
}
