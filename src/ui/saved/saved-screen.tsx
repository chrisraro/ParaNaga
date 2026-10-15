"use client";

// Saved (artboard Saved; Increment A, Task 8; decision D3): Trips · Places · History, all read from
// this phone (IndexedDB), nothing from or to a server except the revision check of saved trips
// (GET network head / snapshot, no coordinates).
//
//  - Trips: self-contained cards (they work with no signal and no tiles): "Available offline",
//    "Changed since saved" when the published network changed under the trip, From / to, the leg
//    strip, "Time not available · {fare} · data from {date}", the saved date, and "Open trip" or
//    "Review changes" (the map restores the trip and re-plans it on the current data). "Remove"
//    with an Undo note (no swipe).
//  - Places: tap to plan to it, "Use as start", "Rename", "Remove"; "Add a place" opens Search in
//    save mode.
//  - History: off by default (the artboard's "History is off" card); on: "{from} → {to} · {date}"
//    rows (labels only), pruned after 90 days, and "Clear history".
// The section is in the URL (?tab=trips|places|history), changed with history.replaceState.

import "@/ui/kit/styles";
import "./saved.css";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState, type ReactNode } from "react";
import { clearHistory } from "@/client/history/trip-history";
import { usePrefs } from "@/client/prefs/use-prefs";
import { useHistoryList, useSavedPlaces, useSavedTrips, useTripRevalidation } from "@/client/saved/use-saved";
import { deleteSavedPlace, deleteSavedTrip, putSavedPlace, putSavedTrip } from "@/client/storage/db";
import {
  historyLine,
  manilaDate,
  placeSubText,
  savedTripResponse,
  tripCardMeta,
  type SavedPlace,
  type SavedTrip,
  type SavedTripStatus,
} from "@/domain/saved/saved";
import { useAppFrame } from "@/ui/app-shell/app-frame-context";
import { ConfirmDialog } from "@/ui/kit/confirm-dialog";
import { Note } from "@/ui/kit/note";
import { Segmented, type SegmentedOption } from "@/ui/kit/segmented";
import { LegStrip } from "@/ui/trip/trip-options";
import { planLookups } from "@/ui/trip/trip-parts";
import { SavePlaceDialog } from "./save-place-dialog";

export type SavedTab = "trips" | "places" | "history";
const TABS: readonly SavedTab[] = ["trips", "places", "history"];

export const TRIPS_INTRO = "Saved trips open without signal. Map tiles may be missing offline, so each card works as text.";
export const NO_TRIPS = "No saved trips yet. Plan a trip, then tap Save on its details.";
export const NO_PLACES = "No saved places yet.";
const DROPPED_NOTE = "Some saved items on this phone could not be read and were removed.";

export function parseSavedTab(raw: string | null): SavedTab {
  return TABS.includes(raw as SavedTab) ? (raw as SavedTab) : "trips";
}

// ------------------------------------------------------------------ icons

const ICON = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false } as const;

function DownloadIcon() {
  return (
    <svg {...ICON} width="13" height="13" viewBox="0 0 24 24" strokeWidth="2.6">
      <path d="M12 3v12M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}
function WarnIcon() {
  return (
    <svg {...ICON} width="13" height="13" viewBox="0 0 24 24" strokeWidth="2.6">
      <path d="M12 8v5M12 17h.01M10.3 3.9L2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg {...ICON} width="16" height="16" viewBox="0 0 24 24" strokeWidth="2.2">
      <path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg {...ICON} width="20" height="20" viewBox="0 0 24 24" strokeWidth="2.4">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function HistoryIcon() {
  return (
    <svg {...ICON} width="30" height="30" viewBox="0 0 24 24" strokeWidth="2">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />
    </svg>
  );
}

// ------------------------------------------------------------------ shared

/** "Removed …" with Undo (the swipe-free delete). Undo puts the record back as it was. */
type Removed = { text: string; undo: () => Promise<void> } | null;

function UndoNote({ removed, onDone }: { removed: Removed; onDone: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="pn-saved__undo" role="status" data-testid="saved-undo">
      {removed ? (
        <>
          <span>{failed ? "Could not undo on this phone." : removed.text}</span>
          {failed ? null : (
            <button
              type="button"
              className="pn-text-btn"
              onClick={() =>
                removed.undo().then(
                  () => onDone(),
                  () => setFailed(true),
                )
              }
            >
              Undo
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="pn-detail__stack" role="status" aria-label={label}>
      <div className="pn-skeleton" style={{ height: 160 }} />
    </div>
  );
}

// ------------------------------------------------------------------ trips

function TripCard({ trip, status, onOpen, onRemove }: { trip: SavedTrip; status: SavedTripStatus | undefined; onOpen: () => void; onRemove: () => void }) {
  const changed = status === "changed";
  const lookups = useMemo(() => planLookups(savedTripResponse(trip)), [trip]);
  const id = useId();
  return (
    <li>
      <article className="pn-saved-card" aria-labelledby={`${id}-to`} data-testid="saved-trip">
        <div className="pn-saved-card__badges">
          <span className="pn-saved-badge pn-saved-badge--offline">
            <DownloadIcon />
            Available offline
          </span>
          {changed ? (
            <span className="pn-saved-badge pn-saved-badge--changed" data-testid="saved-trip-changed">
              <WarnIcon />
              Changed since saved
            </span>
          ) : null}
        </div>
        <div>
          <p className="pn-saved-card__from">From {trip.start.label}</p>
          <h2 id={`${id}-to`} className="pn-saved-card__to">
            {trip.destination.label}
          </h2>
        </div>
        <LegStrip option={trip.option} lookups={lookups} />
        <p className="pn-saved-card__meta">{tripCardMeta(trip)}</p>
        <p className="pn-saved-card__date">Saved {manilaDate(trip.savedAt) ?? "on this phone"}</p>
        <div className="pn-saved-card__actions">
          <button type="button" className={changed ? "pn-saved-cta pn-saved-cta--primary" : "pn-saved-cta"} onClick={onOpen} data-testid="saved-trip-open">
            {changed ? "Review changes" : "Open trip"}
          </button>
          <button type="button" className="pn-text-btn pn-saved__remove" onClick={onRemove} aria-label={`Remove trip to ${trip.destination.label}`}>
            Remove
          </button>
        </div>
      </article>
    </li>
  );
}

function TripsPanel() {
  const trips = useSavedTrips();
  const frame = useAppFrame();
  const router = useRouter();
  const statuses = useTripRevalidation(trips.status === "ready" ? trips.records : null);
  const [removed, setRemoved] = useState<Removed>(null);

  if (trips.status === "loading") return <Loading label="Loading saved trips" />;
  if (trips.status === "error") return <Note testId="saved-error">Saved trips could not be read on this phone.</Note>;

  const open = (trip: SavedTrip) => {
    frame?.requestTrip(trip.id);
    router.push("/app");
  };
  const remove = (trip: SavedTrip) => {
    setRemoved(null);
    deleteSavedTrip(trip.id).then(
      () => setRemoved({ text: `Removed the trip to ${trip.destination.label}.`, undo: () => putSavedTrip(trip) }),
      () => setRemoved(null),
    );
  };

  return (
    <>
      <p className="pn-saved__intro">{TRIPS_INTRO}</p>
      {trips.dropped > 0 ? <Note testId="saved-dropped">{DROPPED_NOTE}</Note> : null}
      {trips.records.length === 0 ? (
        <p className="pn-saved__empty" data-testid="saved-trips-empty">
          {NO_TRIPS}
        </p>
      ) : (
        <ul className="pn-saved__cards" aria-label="Saved trips">
          {trips.records.map((t) => (
            <TripCard key={t.id} trip={t} status={statuses.get(t.id)} onOpen={() => open(t)} onRemove={() => remove(t)} />
          ))}
        </ul>
      )}
      <UndoNote removed={removed} onDone={() => setRemoved(null)} />
    </>
  );
}

// ------------------------------------------------------------------ places

function PlaceRow({ place, onUse, onRename, onRemove }: { place: SavedPlace; onUse: (which: "start" | "destination") => void; onRename: () => void; onRemove: () => void }) {
  return (
    <li className="pn-saved-place" data-testid="saved-place">
      <button type="button" className="pn-cell pn-saved-place__main" onClick={() => onUse("destination")}>
        <span className="pn-saved-place__icon">
          <PinIcon />
        </span>
        <span className="pn-cell__text">
          <span className="pn-cell__title">{place.label}</span>
          <span className="pn-cell__sub">{placeSubText(place.source)}</span>
        </span>
        <span className="sr-only">: plan a trip to here</span>
      </button>
      <div className="pn-saved-place__actions">
        <button type="button" className="pn-text-btn" onClick={() => onUse("start")} aria-label={`Use ${place.label} as start`}>
          Use as start
        </button>
        <button type="button" className="pn-text-btn" onClick={onRename} aria-label={`Rename ${place.label}`}>
          Rename
        </button>
        <button type="button" className="pn-text-btn" onClick={onRemove} aria-label={`Remove ${place.label}`}>
          Remove
        </button>
      </div>
    </li>
  );
}

function PlacesPanel() {
  const places = useSavedPlaces();
  const frame = useAppFrame();
  const router = useRouter();
  const [renaming, setRenaming] = useState<SavedPlace | null>(null);
  const [removed, setRemoved] = useState<Removed>(null);
  const titleId = useId();

  if (places.status === "loading") return <Loading label="Loading saved places" />;
  if (places.status === "error") return <Note testId="saved-error">Saved places could not be read on this phone.</Note>;

  const use = (place: SavedPlace, which: "start" | "destination") => {
    frame?.requestEndpoint(which, { point: { ...place.point }, label: place.label, place: place.source });
    router.push("/app");
  };
  const remove = (place: SavedPlace) => {
    setRemoved(null);
    deleteSavedPlace(place.id).then(
      () => setRemoved({ text: `Removed ${place.label}.`, undo: () => putSavedPlace(place) }),
      () => setRemoved(null),
    );
  };

  return (
    <section className="pn-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="pn-section__title">
        Saved places
      </h2>
      {places.dropped > 0 ? <Note testId="saved-dropped">{DROPPED_NOTE}</Note> : null}
      <ul className="pn-group" data-testid="saved-places">
        {places.records.length === 0 ? (
          <li className="pn-cell pn-cell--empty" data-testid="saved-places-empty">
            {NO_PLACES}
          </li>
        ) : (
          places.records.map((p) => (
            <PlaceRow key={p.id} place={p} onUse={(which) => use(p, which)} onRename={() => setRenaming(p)} onRemove={() => remove(p)} />
          ))
        )}
        <li>
          <Link href="/app/search?for=save" className="pn-cell pn-saved-add" data-testid="saved-add-place">
            <PlusIcon />
            Add a place
          </Link>
        </li>
      </ul>
      <UndoNote removed={removed} onDone={() => setRemoved(null)} />
      <SavePlaceDialog
        open={renaming !== null}
        title="Rename place"
        confirmLabel="Rename"
        initialLabel={renaming?.label ?? ""}
        onSave={async (label) => {
          if (!renaming) return;
          await putSavedPlace({ ...renaming, label });
          setRenaming(null);
        }}
        onCancel={() => setRenaming(null)}
        testId="saved-rename-dialog"
      />
    </section>
  );
}

// ------------------------------------------------------------------ history

function HistoryOff() {
  return (
    <section className="pn-saved-off" aria-labelledby="pn-history-off" data-testid="history-off">
      <span className="pn-saved-off__icon">
        <HistoryIcon />
      </span>
      <h2 id="pn-history-off" className="pn-saved-off__title">
        History is off
      </h2>
      <p className="pn-saved-off__text">ParaNaga keeps no record of your trips unless you turn history on. When on, it stays on this device.</p>
      <Link href="/app/more" className="pn-saved-off__link">
        Turn on in More
      </Link>
    </section>
  );
}

function HistoryPanel() {
  const { historyEnabled } = usePrefs();
  const history = useHistoryList(historyEnabled);
  const [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState("");
  const titleId = useId();
  if (!historyEnabled) return <HistoryOff />;
  if (history.status === "loading") return <Loading label="Loading trip history" />;
  if (history.status === "error") return <Note testId="saved-error">Trip history could not be read on this phone.</Note>;
  const onClear = () => {
    setConfirm(false);
    setStatus("");
    clearHistory().then(
      () => setStatus("Trip history on this phone deleted."),
      () => setStatus("The trip history could not be deleted. Try again."),
    );
  };
  return (
    <section className="pn-section" aria-labelledby={titleId} data-testid="history-on">
      <h2 id={titleId} className="pn-section__title">
        Trip history
      </h2>
      {history.dropped > 0 ? <Note>{DROPPED_NOTE}</Note> : null}
      <ul className="pn-group" data-testid="history-list">
        {history.records.length === 0 ? (
          <li className="pn-cell pn-cell--empty">No trips in history yet.</li>
        ) : (
          history.records.map((e) => (
            <li key={e.id} className="pn-cell pn-cell--compact">
              <span className="pn-cell__title">{historyLine(e)}</span>
            </li>
          ))
        )}
      </ul>
      <Note>Kept on this phone for 90 days. Only place names are recorded, never locations.</Note>
      {history.records.length > 0 ? (
        <button type="button" className="pn-btn pn-btn--secondary pn-saved__clear" onClick={() => setConfirm(true)}>
          Clear history
        </button>
      ) : null}
      <p className="pn-saved__status" aria-live="polite">
        {status}
      </p>
      <ConfirmDialog
        open={confirm}
        title="Delete the trip history on this phone?"
        confirmLabel="Clear history"
        tone="danger"
        onConfirm={onClear}
        onCancel={() => setConfirm(false)}
        testId="history-clear-dialog"
      />
    </section>
  );
}

// ------------------------------------------------------------------ screen

const TAB_OPTIONS: readonly SegmentedOption<SavedTab>[] = [
  { value: "trips", label: "Trips", id: "pn-saved-tab-trips", controls: "pn-saved-panel" },
  { value: "places", label: "Places", id: "pn-saved-tab-places", controls: "pn-saved-panel" },
  { value: "history", label: "History", id: "pn-saved-tab-history", controls: "pn-saved-panel" },
];

const PANELS: Record<SavedTab, () => ReactNode> = {
  trips: () => <TripsPanel />,
  places: () => <PlacesPanel />,
  history: () => <HistoryPanel />,
};

export function SavedScreen() {
  const params = useSearchParams();
  const fromUrl = parseSavedTab(params.get("tab"));
  // The chosen section, kept in step with ?tab= when a navigation changes it (back from Search to
  // ?tab=places); a tap replaces the URL in place (no navigation, no request).
  const [tab, setTab] = useState(fromUrl);
  const [seenUrl, setSeenUrl] = useState(fromUrl);
  if (fromUrl !== seenUrl) {
    setSeenUrl(fromUrl);
    setTab(fromUrl);
  }
  const choose = (next: SavedTab) => {
    setTab(next);
    window.history.replaceState(window.history.state, "", next === "trips" ? "/app/saved" : `/app/saved?tab=${next}`);
  };
  return (
    <div className="pn-saved" data-testid="saved-screen">
      <Segmented options={TAB_OPTIONS} value={tab} onChange={choose} label="Saved sections" variant="tablist" testId="saved-tabs" />
      <div id="pn-saved-panel" role="tabpanel" aria-labelledby={`pn-saved-tab-${tab}`} className="pn-saved__panel" data-testid={`saved-panel-${tab}`}>
        {PANELS[tab]()}
      </div>
    </div>
  );
}
