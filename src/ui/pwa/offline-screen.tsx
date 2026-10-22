"use client";

// /offline (Task 12): what the service worker shows for a page that cannot open without the
// network. Everything comes from this phone (IndexedDB): the date of the data it holds and the
// saved trips, each opening inline as text steps (the map needs the network for its background,
// and this page has none). Links go to the two pages that do open offline: the map and Saved.

import "@/ui/home/home-screen.css";
import "./pwa.css";

import { useEffect, useState } from "react";
import { useSnapshot } from "@/client/network/use-snapshot";
import { useSavedWalkLengths } from "@/client/network/use-walk-graph";
import { useSavedTrips } from "@/client/saved/use-saved";
import { readSnapshotMeta } from "@/client/storage/db";
import { offlineDataLine } from "@/domain/pwa/offline-copy";
import type { EtaModel } from "@/domain/api/schemas";
import { tripCardMeta, type SavedTrip, type SnapshotMeta } from "@/domain/saved/saved";
import { savedTripSteps } from "@/domain/saved/trip-text";
import { useT } from "@/i18n/provider";

function DataLine() {
  const t = useT().pwa;
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
  return <p data-testid="offline-data-date">{meta === undefined ? t.pageChecking : offlineDataLine(meta?.publishedAt, meta !== null, t)}</p>;
}

function OfflineTripMeta({ trip, etaModel }: { trip: SavedTrip; etaModel: EtaModel | null }) {
  const walkLengths = useSavedWalkLengths(trip.option, trip.revisionId);
  return <p className="pn-offline__meta">{tripCardMeta(trip, etaModel, new Date(), walkLengths)}</p>;
}

function SavedTrips() {
  const t = useT();
  const trips = useSavedTrips();
  // The cached snapshot's time model (the service worker answers offline); none: "Time not available".
  const snapshot = useSnapshot(true).snapshot;
  if (trips.status === "loading") return <p>{t.pwa.pageReading}</p>;
  if (trips.status === "error") return <p>{trips.unavailable ? t.pwa.pageStorageBlocked : t.pwa.pageReadFailed}</p>;
  if (trips.records.length === 0) return <p>{t.pwa.pageNoTrips}</p>;
  return (
    <ul className="pn-offline__trips" data-testid="offline-trips">
      {trips.records.map((trip) => (
        <li key={trip.id}>
          <details className="pn-offline__trip" data-testid="offline-trip">
            <summary>
              <span className="pn-offline__trip-to">{t.pwa.pageTripTo(trip.destination.label)}</span>
              <span className="pn-offline__trip-from">{t.pwa.pageTripFrom(trip.start.label)}</span>
              <span className="pn-offline__trip-hint">{t.pwa.pageShowSteps}</span>
            </summary>
            <ol className="pn-offline__steps">
              {savedTripSteps(trip).map((step, i) => (
                // Fixed text of this saved card: its order is its identity.
                <li key={i}>{step}</li>
              ))}
            </ol>
            <OfflineTripMeta trip={trip} etaModel={snapshot?.etaModel ?? null} />
          </details>
        </li>
      ))}
    </ul>
  );
}

export function OfflineScreen() {
  const t = useT().pwa;
  return (
    <main className="pn-pwa pn-offline" data-testid="offline-page">
      <div className="pn-offline__inner">
        <h1>{t.pageTitle}</h1>
        <DataLine />
        <p>{t.pageNeedsConnection}</p>
        <nav className="pn-offline__links" aria-label={t.pageLinksLabel}>
          <a href="/app">{t.pageOpenMap}</a>
          <a href="/app/saved">{t.pageSaved}</a>
        </nav>
        <h2>{t.pageSavedTrips}</h2>
        <SavedTrips />
      </div>
    </main>
  );
}
