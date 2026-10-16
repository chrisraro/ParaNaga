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
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { clearHistory } from "@/client/history/trip-history";
import { useSnapshot } from "@/client/network/use-snapshot";
import { usePrefs } from "@/client/prefs/use-prefs";
import { useHistoryList, useSavedPlaces, useSavedTrips, useTripRevalidation } from "@/client/saved/use-saved";
import { deleteSavedPlace, deleteSavedTrip, putSavedPlace, putSavedTrip, removeUnreadable } from "@/client/storage/db";
import type { EtaModel } from "@/domain/api/schemas";
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
const NEWER_NOTE = "Some saved items on this phone are from a newer version of ParaNaga and can't be shown here. They are kept as they are.";
const UNREADABLE_NOTE = "Some saved items on this phone are damaged and can't be read. They are kept until you remove them.";
const UNAVAILABLE = "Saving needs storage on this phone, which is blocked or not available (for example in private browsing).";

function readError(what: string, unavailable: boolean): string {
  return unavailable ? UNAVAILABLE : `${what} could not be read on this phone.`;
}

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

/**
 * Records this store could not read. Newer-format ones (another tab on a newer ParaNaga) are only
 * mentioned; damaged ones (failed validation) can be removed, after a confirmation, and only those.
 * Always mounted (the notes show only while something is skipped), so the "Removed …" status
 * outlives the notes; after a removal focus goes to that status line, so it is read out.
 */
function SkippedRecords({ store, dropped, unreadable }: { store: "savedTrips" | "savedPlaces" | "history"; dropped: number; unreadable: number }) {
  const [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState("");
  const statusRef = useRef<HTMLParagraphElement>(null);
  const newer = dropped - unreadable;
  const onRemove = () => {
    setConfirm(false);
    setStatus("");
    removeUnreadable(store).then(
      (n) => {
        setStatus(n === 1 ? "Removed 1 damaged item." : `Removed ${n} damaged items.`);
        statusRef.current?.focus();
      },
      () => setStatus("Could not remove on this phone."),
    );
  };
  return (
    <>
      {dropped > 0 ? (
        <div data-testid="saved-dropped">
          {newer > 0 ? <Note>{NEWER_NOTE}</Note> : null}
          {unreadable > 0 ? (
            <>
              <Note>{UNREADABLE_NOTE}</Note>
              <button type="button" className="pn-text-btn" onClick={() => setConfirm(true)} data-testid="saved-remove-unreadable">
                Remove unreadable items
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={confirm && unreadable > 0}
        title={unreadable === 1 ? "Remove 1 damaged item from this phone?" : `Remove ${unreadable} damaged items from this phone?`}
        confirmLabel="Remove"
        tone="danger"
        onConfirm={onRemove}
        onCancel={() => setConfirm(false)}
        testId="saved-remove-unreadable-dialog"
      />
      <p ref={statusRef} tabIndex={-1} className="pn-saved__status" aria-live="polite" data-testid="saved-dropped-status">
        {status}
      </p>
    </>
  );
}

/**
 * "Removed …" with Undo (the swipe-free delete), or why a removal failed. Each removal is numbered
 * (`n`), so a failed Undo of one removal never carries over to the next.
 */
type Removed = { n: number; text: string; undo: (() => Promise<void>) | null } | null;

function useRemoval() {
  const [removed, setRemoved] = useState<Removed>(null);
  const run = (remove: () => Promise<void>, text: string, undo: () => Promise<void>) => {
    setRemoved(null);
    remove().then(
      () => setRemoved((prev) => ({ n: (prev?.n ?? 0) + 1, text, undo })),
      () => setRemoved((prev) => ({ n: (prev?.n ?? 0) + 1, text: "Could not remove on this phone.", undo: null })),
    );
  };
  return { removed, run, clear: () => setRemoved(null) };
}

function UndoBody({ removed, onDone }: { removed: NonNullable<Removed>; onDone: () => void }) {
  const [failed, setFailed] = useState(false);
  const undo = removed.undo;
  return (
    <>
      <span>{failed ? "Could not undo on this phone." : removed.text}</span>
      {failed || !undo ? null : (
        <button
          type="button"
          className="pn-text-btn"
          onClick={() =>
            undo().then(
              () => onDone(),
              () => setFailed(true),
            )
          }
        >
          Undo
        </button>
      )}
    </>
  );
}

function UndoNote({ removed, onDone }: { removed: Removed; onDone: () => void }) {
  return (
    <div className="pn-saved__undo" role="status" data-testid="saved-undo">
      {removed ? <UndoBody key={removed.n} removed={removed} onDone={onDone} /> : null}
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

function TripCard({
  trip,
  status,
  onOpen,
  onRemove,
  model,
}: {
  trip: SavedTrip;
  status: SavedTripStatus | undefined;
  onOpen: () => void;
  onRemove: () => void;
  model?: EtaModel | null;
}) {
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
        <p className="pn-saved-card__meta">{tripCardMeta(trip, model)}</p>
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
  const snapshotState = useSnapshot(true);
  const statuses = useTripRevalidation(trips.status === "ready" ? trips.records : null);
  const removal = useRemoval();

  if (trips.status === "loading") return <Loading label="Loading saved trips" />;
  if (trips.status === "error") return <Note testId="saved-error">{readError("Saved trips", trips.unavailable)}</Note>;

  const open = (trip: SavedTrip) => {
    frame?.requestTrip(trip.id);
    router.push("/app");
  };
  const remove = (trip: SavedTrip) => {
    removal.run(() => deleteSavedTrip(trip.id), `Removed the trip to ${trip.destination.label}.`, () => putSavedTrip(trip));
  };

  return (
    <>
      <p className="pn-saved__intro">{TRIPS_INTRO}</p>
      <SkippedRecords store="savedTrips" dropped={trips.dropped} unreadable={trips.unreadable} />
      {trips.records.length === 0 ? (
        <p className="pn-saved__empty" data-testid="saved-trips-empty">
          {NO_TRIPS}
        </p>
      ) : (
        <ul className="pn-saved__cards" aria-label="Saved trips">
          {trips.records.map((t) => (
            <TripCard
              key={t.id}
              trip={t}
              status={statuses.get(t.id)}
              onOpen={() => open(t)}
              onRemove={() => remove(t)}
              model={snapshotState.snapshot?.etaModel}
            />
          ))}
        </ul>
      )}
      <UndoNote removed={removal.removed} onDone={removal.clear} />
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
        <button type="button" className="pn-text-btn" onClick={() => onUse("start")} aria-label={`Use as start: ${place.label}`}>
          Use as start
        </button>
        <button type="button" className="pn-text-btn" onClick={onRename} aria-label={`Rename: ${place.label}`}>
          Rename
        </button>
        <button type="button" className="pn-text-btn" onClick={onRemove} aria-label={`Remove: ${place.label}`}>
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
  const removal = useRemoval();
  const titleId = useId();

  if (places.status === "loading") return <Loading label="Loading saved places" />;
  if (places.status === "error") return <Note testId="saved-error">{readError("Saved places", places.unavailable)}</Note>;

  const use = (place: SavedPlace, which: "start" | "destination") => {
    frame?.requestEndpoint(which, { point: { ...place.point }, label: place.label, place: place.source });
    router.push("/app");
  };
  const remove = (place: SavedPlace) => {
    removal.run(() => deleteSavedPlace(place.id), `Removed ${place.label}.`, () => putSavedPlace(place));
  };

  return (
    <section className="pn-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="pn-section__title">
        Saved places
      </h2>
      <SkippedRecords store="savedPlaces" dropped={places.dropped} unreadable={places.unreadable} />
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
      <UndoNote removed={removal.removed} onDone={removal.clear} />
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
  if (history.status === "error") return <Note testId="saved-error">{readError("Trip history", history.unavailable)}</Note>;
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
      <SkippedRecords store="history" dropped={history.dropped} unreadable={history.unreadable} />
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
