"use client";

// Reopening a saved trip on the home screen ("Open trip" / "Review changes" on Saved, through the
// app frame's requestTrip). The card is read from this phone; the home screen restores both ends
// (onRestore) and the plan always re-runs on the current data. Then:
//  - while that plan is loading or failed (offline), the saved option shows AS SAVED, with a note
//    naming its data date (never as the current plan);
//  - once the plan is in: the same option opens (onOpen), with "Re-planned on the current data"
//    when the revision changed; or, when it is gone or its rides changed, the options show under
//    "Route changed since you saved this".
// Changing an end ends the reopen. Render-phase updates only set state ("adjust state while
// rendering"); the device read happens in an effect.

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { getSavedTrip } from "@/client/storage/db";
import type { TripPlanState } from "@/client/trip/use-trip-plan";
import type { PlanOptionDto, PlanResponse } from "@/domain/api/plan";
import { manilaDate, resolveReopen, samePoint, savedTripResponse, type SavedTrip } from "@/domain/saved/saved";
import type { EndpointsState } from "@/domain/trip/endpoints";
import { useApplyOnce, type TripRequest } from "@/ui/app-shell/app-frame-context";
import type { TripEnds, TripNote } from "@/ui/trip/trip-detail";

/**
 * "waiting": the re-plan has not settled, the saved option shows as saved; "changed": the options
 * show under the changed note; "done": nothing more to do. `dismissed`: the user went back from the
 * saved option before the re-plan settled.
 */
type Restored = { card: SavedTrip; phase: "waiting" | "changed" | "done"; dismissed: boolean };

/** The note on a saved option shown as saved: checking, or why the current data is not in. */
export function storedNote(card: SavedTrip, error: "offline" | "server" | "invalid" | null): TripNote {
  const date = manilaDate(card.publishedAt) ?? `revision ${card.revisionLabel}`;
  if (error === "offline") return { text: `Offline: shown as saved, with data from ${date}. It may have changed since.`, tone: "warning" };
  if (error) return { text: `Could not check the current data: shown as saved, with data from ${date}.`, tone: "warning" };
  return { text: `Saved trip, data from ${date}. Checking the current data…`, tone: "info" };
}

export const REPLANNED_NOTE: TripNote = { text: "Re-planned on the current data", tone: "info" };

type Args = {
  tripRequest: TripRequest | null;
  endpoints: EndpointsState;
  plan: TripPlanState & { retry: () => void };
  /** Both ends are set. */
  ready: boolean;
  /** Restore the card's two ends and reset the home screen's trip state (called from an effect). */
  onRestore: (card: SavedTrip) => void;
  /** The card is no longer on this phone (or storage failed). */
  onMissing: () => void;
  /** Render phase, state setters only: the re-plan has the saved option; open it. */
  onOpen: (optionId: string) => void;
};

export type SavedTripReopen = {
  /** The saved option shown as saved (re-plan pending or failed), or null. */
  stored: { data: PlanResponse; option: PlanOptionDto; ends: TripEnds; note: TripNote } | null;
  /** Show "Route changed since you saved this" above the options. */
  changed: boolean;
  /** Note for the live option the reopen opened ("Re-planned on the current data"). */
  note: TripNote | null;
  clearNote: () => void;
  /** Back from the saved option before the re-plan settled. */
  dismissStored: () => void;
};

export function useSavedTripReopen({ tripRequest, endpoints, plan, ready, onRestore, onMissing, onOpen }: Args): SavedTripReopen {
  const [restored, setRestored] = useState<Restored | null>(null);
  const [note, setNote] = useState<TripNote | null>(null);

  const active =
    restored !== null &&
    endpoints.start !== null &&
    endpoints.destination !== null &&
    samePoint(endpoints.start.point, restored.card.start.point) &&
    samePoint(endpoints.destination.point, restored.card.destination.point);
  if (restored !== null && !active) {
    // An end changed (cleared, swapped, re-pinned): this is a new trip now.
    setRestored(null);
    setNote(null);
  }
  if (restored && active && restored.phase === "waiting" && plan.status === "ready" && !plan.refreshing) {
    const outcome = resolveReopen(restored.card, plan.data);
    if (outcome.kind === "changed") {
      setRestored({ ...restored, phase: "changed" });
    } else {
      setRestored({ ...restored, phase: "done" });
      if (!restored.dismissed) {
        onOpen(outcome.optionId);
        setNote(outcome.kind === "replanned" ? REPLANNED_NOTE : null);
      }
    }
  }

  // Load the requested card from this phone, then restore it.
  const [load, setLoad] = useState<{ id: string; n: number } | null>(null);
  useApplyOnce(tripRequest, (request) => setLoad({ id: request.savedTripId, n: request.n }));
  const restore = useEffectEvent((card: SavedTrip | null) => {
    if (!card) {
      onMissing();
      return;
    }
    onRestore(card);
    setNote(null);
    setRestored({ card, phase: "waiting", dismissed: false });
    // Always re-plan on the current data, even when these ends are the trip already on screen.
    plan.retry();
  });
  useEffect(() => {
    if (!load) return undefined;
    let live = true;
    getSavedTrip(load.id).then(
      (card) => {
        if (live) restore(card);
      },
      () => {
        if (live) restore(null);
      },
    );
    return () => {
      live = false;
    };
  }, [load]);

  const showStored = ready && restored !== null && active && restored.phase === "waiting" && !restored.dismissed;
  const card = restored?.card ?? null;
  const storedData = useMemo(() => (card ? savedTripResponse(card) : null), [card]);
  const error = plan.status === "error" ? plan.kind : null;
  const stored =
    showStored && card && storedData
      ? { data: storedData, option: card.option, ends: { start: card.start, destination: card.destination }, note: storedNote(card, error) }
      : null;

  return {
    stored,
    changed: restored !== null && active && restored.phase === "changed",
    note,
    clearNote: () => setNote(null),
    dismissStored: () => {
      if (restored) setRestored({ ...restored, dismissed: true });
    },
  };
}
