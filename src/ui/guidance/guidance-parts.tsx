"use client";

// Pieces shared by the Walk, Ride, Transfer and Arrive steps (artboards Walk / Ride / Transfer /
// Arrive). The copy comes from the guidance view (src/domain/guidance/view.ts); the few lines
// written here are about the app itself (location, keep open), never about the transport data.

import type { RefObject } from "react";
import type { GeolocationState } from "@/client/geo/use-geolocation";
import type { GuidanceTap } from "@/client/guidance/use-guidance-session";
import type { GuidanceAction } from "@/domain/guidance/view";
import { SheetBar } from "@/ui/app-shell/sheet-bar";

export type LocationUi = { state: GeolocationState; watching: boolean; onEnable: () => void };

export type StepProps<V> = {
  view: V;
  onSend: (event: GuidanceTap) => void;
  location: LocationUi;
  /** Heading ref: focus moves here when the step (or its buttons) change. */
  headingRef: RefObject<HTMLHeadingElement | null>;
};

export const USE_LOCATION = "Use my location";

/** The step's own buttons (End lives in the header, so it is left out here). */
export function GuidanceButtons({ actions, onSend }: { actions: readonly GuidanceAction[]; onSend: (event: GuidanceTap) => void }) {
  const shown = actions.filter((a) => a.event !== "end");
  if (shown.length === 0) return null;
  return (
    <SheetBar className="pn-guide__actions">
      {shown.map((a) => (
        <button
          key={a.event}
          type="button"
          className={a.kind === "primary" ? "pn-btn pn-btn--primary" : "pn-btn pn-btn--secondary"}
          onClick={() => onSend({ type: a.event } as GuidanceTap)}
          data-testid={`guidance-${a.event}`}
        >
          {a.label}
        </button>
      ))}
    </SheetBar>
  );
}

/** "Undo last step" (view.undo): undoes the last confirmation only. */
export function UndoButton({ undo, onSend }: { undo: GuidanceAction | null; onSend: (event: GuidanceTap) => void }) {
  if (!undo) return null;
  return (
    <button type="button" className="pn-text-btn pn-guide__undo" onClick={() => onSend({ type: "back" })} data-testid="guidance-undo">
      {undo.label}
    </button>
  );
}

export function KeepOpen({ text }: { text: string }) {
  return (
    <p className="pn-guide__keep" data-testid="guidance-keep-open">
      {text}
    </p>
  );
}

export function RouteChip({ chip }: { chip: string }) {
  return (
    <span className="pn-loop-chip pn-guide__chip">
      <span className="pn-loop-chip__icon">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M20 12a8 8 0 1 1-3-6.2M20 4v5h-5" />
        </svg>
      </span>
      {chip}
    </span>
  );
}

export function GuidanceNotes({ notes }: { notes: readonly string[] }) {
  return (
    <>
      {notes.map((note) => (
        <p key={note} className="pn-guide__card" data-testid="guidance-note">
          {note}
        </p>
      ))}
    </>
  );
}

/**
 * Location for progress: optional, only on a tap, and every step still works by its buttons.
 * `manual` names the button to tap instead.
 */
export function LocationOffer({ location, manual }: { location: LocationUi; manual: string }) {
  const { state, watching, onEnable } = location;
  if (watching) return null;
  if (state === "requesting") {
    return (
      <p className="pn-guide__loc" role="status">
        Finding your location…
      </p>
    );
  }
  if (state === "denied" || state === "unsupported" || state === "insecure") {
    return (
      <p className="pn-guide__loc pn-guide__loc--off" data-testid="guidance-location-off">
        Location off. Tap “{manual}” when there.
      </p>
    );
  }
  if (state === "unavailable" || state === "timeout") {
    return (
      <p className="pn-guide__loc pn-guide__loc--off" data-testid="guidance-location-off">
        No location now. Tap “{manual}” when there.
      </p>
    );
  }
  return (
    <button type="button" className="pn-guide__use-loc" onClick={onEnable} data-testid="guidance-use-location">
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M21 3L3 10.5l7.5 2.9L13.4 21z" fill="currentColor" />
      </svg>
      {USE_LOCATION}
    </button>
  );
}
