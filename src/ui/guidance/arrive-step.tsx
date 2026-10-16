"use client";

// Arrive (artboard Arrive): "You've arrived", "{destination}. Guidance has ended and ParaNaga has
// stopped using your location." (the watch and the wake lock stop before this renders), the trip
// summary (walk estimate, route chips with their stop counts, the fare estimate), a real "Save
// this trip" toggle (the device's saved trips, as in Trip detail) and "Done". No rating (D7), no
// entrance (none is mapped).

import { useState } from "react";
import { useSavedTripToggle } from "@/client/saved/use-saved-trip-toggle";
import type { ArriveView } from "@/domain/guidance/view";
import type { SavedTrip } from "@/domain/saved/saved";
import { SheetBar } from "@/ui/app-shell/sheet-bar";
import { RouteChip, UndoButton, type StepProps } from "./guidance-parts";

function SaveTripRow({ card }: { card: SavedTrip }) {
  const [status, setStatus] = useState("");
  const { kind, waiting, unavailable, toggle } = useSavedTripToggle(
    { optionId: card.option.id, start: card.start.point, destination: card.destination.point, revisionId: card.revisionId },
    () => ({ ...card, id: crypto.randomUUID(), savedAt: new Date().toISOString() }),
    setStatus,
  );
  const saved = kind === "saved";

  return (
    <div className="pn-guide__save">
      <button
        type="button"
        className={saved ? "pn-guide__save-btn pn-guide__save-btn--on" : "pn-guide__save-btn"}
        aria-pressed={saved}
        aria-disabled={waiting || unavailable ? true : undefined}
        onClick={() => void toggle()}
        data-testid="arrive-save"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M6 3h12v18l-6-4.5L6 21z" />
        </svg>
        <span className="pn-guide__save-text">
          <strong>{saved ? "Trip saved" : "Save this trip"}</strong>
          <span>{saved ? "Available offline in Saved" : "Keep it for next time, works offline"}</span>
        </span>
      </button>
      {unavailable ? <p className="pn-guide__note">Saving needs storage on this phone, which is not available.</p> : null}
      <p className="pn-guide__note" aria-live="polite" data-testid="arrive-save-status">
        {status}
      </p>
    </div>
  );
}

export function ArriveStep({ view, onSend, headingRef, card, onDone }: Omit<StepProps<ArriveView>, "location"> & { card: SavedTrip | null; onDone: () => void }) {
  return (
    <section className="pn-guide__step" aria-labelledby="pn-guide-title" data-testid="guidance-arrive">
      <h2 id="pn-guide-title" ref={headingRef} tabIndex={-1} className="pn-guide__title pn-guide__title--big">
        {view.title}
      </h2>
      <p className="pn-guide__body" data-testid="arrive-body">
        {view.body}
      </p>
      <div className="pn-guide__summary" data-testid="arrive-summary">
        <span>{view.summary.walkText}</span>
        {view.summary.rides.map((r, i) => (
          <span key={`${r.chip}-${i}`} className="pn-guide__summary-ride">
            <RouteChip chip={r.chip} />
            <span>{r.stopsText}</span>
          </span>
        ))}
        <span>{view.summary.fareText}</span>
      </div>
      {card ? <SaveTripRow card={card} /> : null}
      {/* "Done" is the view's `end` action: it also clears the trip (the screen's onDone). */}
      <SheetBar className="pn-guide__actions">
        {view.actions
          .filter((a) => a.event === "end")
          .map((a) => (
          <button key={a.event} type="button" className="pn-btn pn-btn--primary" onClick={onDone} data-testid="guidance-done">
            {a.label}
          </button>
        ))}
      </SheetBar>
      <UndoButton undo={view.undo} onSend={onSend} />
    </section>
  );
}
