"use client";

// /offline (Task 12): what the service worker shows for a page that cannot open without the
// network. Everything comes from this phone (IndexedDB): the date of the data it holds and the
// saved trips, each opening inline as text steps (the map needs the network for its background,
// and this page has none). Links go to the two pages that do open offline: the map and Saved.

import "@/ui/home/home-screen.css";
import "./pwa.css";

import { useEffect, useState } from "react";
import { useSnapshot } from "@/client/network/use-snapshot";
import { useSavedTrips } from "@/client/saved/use-saved";
import { readSnapshotMeta } from "@/client/storage/db";
import { offlineDataLine } from "@/domain/pwa/offline-copy";
import { tripCardMeta, type SnapshotMeta } from "@/domain/saved/saved";
import { savedTripSteps } from "@/domain/saved/trip-text";

function DataLine() {
  // undefined: not read yet.
  const [meta, setMeta] = useState<SnapshotMeta | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    readSnapshotMeta().then(
      (m) => live && setMeta(m),
      () => live && setMeta(null),
    );
    return () => {
      live = false;
    };
  }, []);
  return <p data-testid="offline-data-date">{meta === undefined ? "Checking the data on this phone…" : offlineDataLine(meta?.publishedAt, meta !== null)}</p>;
}

function SavedTrips() {
  const trips = useSavedTrips();
  // The cached snapshot's time model (the service worker answers offline); none: "Time not available".
  const snapshot = useSnapshot(true).snapshot;
  if (trips.status === "loading") return <p>Reading saved trips…</p>;
  if (trips.status === "error") return <p>{trips.unavailable ? "Saved trips are not available: storage on this phone is blocked." : "Saved trips could not be read."}</p>;
  if (trips.records.length === 0) return <p>No saved trips on this phone.</p>;
  return (
    <ul className="pn-offline__trips" data-testid="offline-trips">
      {trips.records.map((trip) => (
        <li key={trip.id}>
          <details className="pn-offline__trip" data-testid="offline-trip">
            <summary>
              <span className="pn-offline__trip-to">To {trip.destination.label}</span>
              <span className="pn-offline__trip-from">From {trip.start.label}</span>
              <span className="pn-offline__trip-hint">Show the steps</span>
            </summary>
            <ol className="pn-offline__steps">
              {savedTripSteps(trip).map((step, i) => (
                // Fixed text of this saved card: its order is its identity.
                <li key={i}>{step}</li>
              ))}
            </ol>
            <p className="pn-offline__meta">{tripCardMeta(trip, snapshot?.etaModel ?? null)}</p>
          </details>
        </li>
      ))}
    </ul>
  );
}

export function OfflineScreen() {
  return (
    <main className="pn-pwa pn-offline" data-testid="offline-page">
      <div className="pn-offline__inner">
        <h1>You&apos;re offline</h1>
        <DataLine />
        <p>This page needs a connection. These open without one:</p>
        <nav className="pn-offline__links" aria-label="Open offline">
          <a href="/app">Open the map</a>
          <a href="/app/saved">Saved</a>
        </nav>
        <h2>Saved trips</h2>
        <SavedTrips />
      </div>
    </main>
  );
}
