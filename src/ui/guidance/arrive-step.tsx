"use client";

// Arrive (artboard Arrive): "You've arrived", "{destination}. Guidance has ended and ParaNaga has
// stopped using your location." (the watch and the wake lock stop before this renders), the trip
// summary (walk estimate, route chips with their stop counts, the fare estimate), a real "Save
// this trip" toggle (the device's saved trips, as in Trip detail) and "Done". No rating (D7), no
// entrance (none is mapped).

import { useState } from "react";
import { deleteSavedTrip, putSavedTrip, replaceSavedTrip } from "@/client/storage/db";
import { useSavedTrips } from "@/client/saved/use-saved";
import type { ArriveView } from "@/domain/guidance/view";
import { matchSavedTrip, type SavedTrip } from "@/domain/saved/saved";
import { RouteChip, UndoButton, type StepProps } from "./guidance-parts";

function SaveTripRow({ card }: { card: SavedTrip }) {
  const trips = useSavedTrips();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const match =
    trips.status === "ready" ? matchSavedTrip(trips.records, card.option.id, card.start.point, card.destination.point, card.revisionId) : null;
  const saved = match?.kind === "saved";
  const unavailable = trips.status === "error" && trips.unavailable;
  const waiting = busy || trips.status === "loading";

  const onToggle = async () => {
    if (waiting || unavailable || !match) return;
    setBusy(true);
    setStatus("");
    try {
      const fresh: SavedTrip = { ...card, id: crypto.randomUUID(), savedAt: new Date().toISOString() };
      if (match.kind === "saved") {
        await deleteSavedTrip(match.trip.id);
        setStatus("Removed from saved trips.");
      } else if (match.kind === "older") {
        await replaceSavedTrip(match.trip.id, fresh);
        setStatus("Saved on this phone.");
      } else {
        await putSavedTrip(fresh);
        setStatus("Saved on this phone.");
      }
    } catch {
      setStatus("Could not save on this phone.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pn-guide__save">
      <button
        type="button"
        className={saved ? "pn-guide__save-btn pn-guide__save-btn--on" : "pn-guide__save-btn"}
        aria-pressed={saved}
        aria-disabled={waiting || unavailable ? true : undefined}
        onClick={() => void onToggle()}
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
      <div className="pn-guide__actions">
        {view.actions.map((a) => (
          <button key={a.event} type="button" className="pn-btn pn-btn--primary" onClick={onDone} data-testid="guidance-done">
            {a.label}
          </button>
        ))}
      </div>
      <UndoButton undo={view.undo} onSend={onSend} />
    </section>
  );
}
