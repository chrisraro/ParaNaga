"use client";

// "Save place" on Place detail and "Save this place" on a set trip end: opens the name dialog,
// stores the place on this phone (IndexedDB), and then reads "Saved" (its accessible name says
// that a tap removes it; no pressed state). Tapping "Saved" removes it again. While the saved
// places are still loading a tap does nothing, so a place is never saved twice. Nothing leaves
// the device.

import { useState } from "react";
import { deleteSavedPlace, putSavedPlace } from "@/client/storage/db";
import { useSavedPlaces } from "@/client/saved/use-saved";
import type { LatLng } from "@/domain/geo/types";
import { PLACE_LABEL_MAX, findSavedPlace, takeCodePoints, type SavedPlaceSource } from "@/domain/saved/saved";
import { SavePlaceDialog } from "./save-place-dialog";

type Props = {
  /** Prefilled name (the place's label, or "Pinned location"). */
  label: string;
  point: LatLng;
  source: SavedPlaceSource;
  /** "button": a round-cornered action (Place detail); "option": a row of the home sheet's options. */
  variant?: "button" | "option";
  testId?: string;
};

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M6 3h12v18l-6-4.5L6 21z" />
    </svg>
  );
}

export function SavePlaceButton({ label, point, source, variant = "button", testId = "save-place" }: Props) {
  const places = useSavedPlaces();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [status, setStatus] = useState("");
  const saved = places.status === "ready" ? findSavedPlace(places.records, point) : null;
  const unavailable = places.status === "error" && places.unavailable;
  const loading = places.status === "loading";

  const onClick = () => {
    if (loading) return;
    setStatus("");
    if (!saved) {
      setDialogOpen(true);
      return;
    }
    deleteSavedPlace(saved.id).then(
      () => setStatus(`Removed “${saved.label}” from saved places.`),
      () => setStatus("Could not change saved places on this phone."),
    );
  };

  const save = async (name: string) => {
    await putSavedPlace({ id: crypto.randomUUID(), label: name, point: { lat: point.lat, lng: point.lng }, source, savedAt: new Date().toISOString() });
    setDialogOpen(false);
    setStatus(`Saved “${name}” on this phone.`);
  };

  const className = variant === "option" ? "pn-option" : saved ? "pn-trip-action pn-trip-action--on" : "pn-trip-action";
  const text = saved ? (variant === "option" ? `Saved as “${saved.label}”` : "Saved") : variant === "option" ? "Save this place" : "Save place";
  // The name starts with the visible text and says what a tap does now.
  const name = saved ? `${text}, remove from saved places` : undefined;
  return (
    <>
      {unavailable ? (
        <p className="pn-note-plain">Saving places needs storage on this phone, which is not available.</p>
      ) : (
        <button type="button" className={className} aria-disabled={loading ? true : undefined} onClick={onClick} data-testid={testId} data-state={saved ? "saved" : "none"} aria-label={name}>
          {variant === "option" ? (
            <span className="pn-option__icon">
              <BookmarkIcon filled={saved !== null} />
            </span>
          ) : (
            <BookmarkIcon filled={saved !== null} />
          )}
          {text}
        </button>
      )}
      <p className="sr-only" aria-live="polite" data-testid={`${testId}-status`}>
        {status}
      </p>
      <SavePlaceDialog
        open={dialogOpen}
        title="Save place"
        initialLabel={takeCodePoints(label, PLACE_LABEL_MAX)}
        onSave={save}
        onCancel={() => setDialogOpen(false)}
        testId={`${testId}-dialog`}
      />
    </>
  );
}
