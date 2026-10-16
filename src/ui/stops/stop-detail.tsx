"use client";

// Stop detail (artboard StopDetail) for one mapped stop pin, from GET /api/v1/stops/:id.
// Shows the provisional routes whose pin order lists it and honest unknowns where the artboard has
// survey data. The pin's source record (layer, code, coordinates, raw description) is on Sources and
// credits, one "Sources" link away.

import "@/ui/kit/styles";

import Link from "next/link";
import { photoForStopSource } from "@/domain/media/photos";
import { ReferencePhoto } from "@/ui/places/reference-photo";
import { StopStreetView } from "@/ui/street-view/stop-street-view";
import { useId, useState } from "react";
import { useNetworkResource } from "@/client/network/use-network-resource";
import { stopDetailSchema, type StopDetail } from "@/domain/api/schemas";
import { stopStatusBadge } from "@/domain/network/present";
import { directionText, stopDisplayName, stopLabel } from "@/domain/trip/present";
import { useAppFrame } from "@/ui/app-shell/app-frame-context";
import {
  CandidateRing,
  ChevronRight,
  DetailError,
  DetailLoading,
  DetailNotFound,
  DetailPanel,
  MapIcon,
  WarnIcon,
  useFocusOnMount,
  useReturnToMap,
} from "@/ui/detail/detail-frame";
import { SOURCES_HREF } from "@/ui/help/sources-href";
import { LoopChip } from "@/ui/trip/trip-parts";

export function StopDetailScreen({ id }: { id: string }) {
  const resource = useNetworkResource(`/api/v1/stops/${encodeURIComponent(id)}`, stopDetailSchema);
  if (resource.status === "loading") return <DetailLoading title="Stop" />;
  if (resource.status === "not_found") return <DetailNotFound what="stop" />;
  if (resource.status === "error") return <DetailError title="Stop" offline={resource.offline} onRetry={resource.retry} />;
  return <StopDetailView data={resource.data} />;
}

function ShowOnMap({ lat, lng }: { lat: number; lng: number }) {
  const frame = useAppFrame();
  const returnToMap = useReturnToMap();
  if (!frame) return null;
  return (
    <button
      type="button"
      className="pn-detail__round"
      aria-label="Show on map"
      onClick={() => {
        frame.showOnMap({ lat, lng });
        returnToMap();
      }}
    >
      <MapIcon />
    </button>
  );
}

/**
 * "Set as start" / "Set as destination": the pin's coordinate becomes that trip end through the
 * endpoint channel (same rules as the sheet), then the map shows again.
 */
function UseAsEndpoint({ stop }: { stop: StopDetail["stop"] }) {
  const frame = useAppFrame();
  const returnToMap = useReturnToMap();
  if (!frame) return null;
  const label = stopLabel(stop.name, stop.source.code);
  const set = (which: "start" | "destination") => {
    frame.requestEndpoint(which, { point: { lat: stop.lat, lng: stop.lng }, label });
    returnToMap();
  };
  return (
    <section className="pn-section" aria-label="Use this pin for a trip" data-testid="stop-use-as">
      <div className="pn-detail__row pn-detail__row--actions">
        <button type="button" className="pn-text-btn" onClick={() => set("start")}>
          Set as start
        </button>
        <button type="button" className="pn-text-btn" onClick={() => set("destination")}>
          Set as destination
        </button>
      </div>
      <p className="pn-note-plain">Trips from mapped pins are unverified.</p>
    </section>
  );
}

function servingDirection(direction: StopDetail["servingRoutes"][number]["direction"]): string {
  if (direction === "clockwise" || direction === "counterclockwise") return directionText(direction, "long")!;
  return direction;
}

export function StopDetailView({ data }: { data: StopDetail }) {
  const { stop, sourceRecords, servingRoutes, passingNearby } = data;
  const heading = useFocusOnMount<HTMLHeadingElement>(true);
  const [nearbyOpen, setNearbyOpen] = useState(false);
  const uid = useId(); // per instance: a hidden previous stop panel may still be mounted
  const onRoute = servingRoutes.length > 0;
  const referencePhoto = sourceRecords.map(photoForStopSource).find((photo) => photo !== null);

  return (
    <DetailPanel title="Stop" action={<ShowOnMap lat={stop.lat} lng={stop.lng} />} sources={`${SOURCES_HREF}?stop=${stop.id}`} testId="stop-detail">
      <main className="pn-detail__main pn-detail-in">
        <div className="pn-detail__head">
          <CandidateRing size={40} onRoute={onRoute} />
          <div className="pn-detail__head-text">
            <h1 ref={heading} tabIndex={-1} className="pn-detail__title">
              {stopDisplayName(stop.name, stop.source.code)}
            </h1>
            <span className="pn-badge pn-badge--candidate" data-testid="stop-status-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true" focusable="false">
                <circle cx="12" cy="12" r="8" />
              </svg>
              {stopStatusBadge(stop.status)}
            </span>
          </div>
        </div>

        <div role="note" className="pn-note" data-testid="stop-warning">
          <WarnIcon />
          <p>
            <strong>Not verified for navigation.</strong>
          </p>
        </div>

        <UseAsEndpoint stop={stop} />

        <section className="pn-section" aria-labelledby={`${uid}-serving`}>
          <h2 id={`${uid}-serving`} className="pn-section__title">
            Routes serving this stop
          </h2>
          <ul className="pn-group" data-testid="serving-routes">
            {servingRoutes.length === 0 ? (
              <li className="pn-cell pn-cell--empty">No route&apos;s stop order lists this pin yet.</li>
            ) : (
              servingRoutes.map((r) => (
                <li key={r.variantId}>
                  <Link href={`/app/routes/${encodeURIComponent(r.routeCode)}`} className="pn-cell">
                    <LoopChip leg={{ routeCode: r.routeCode, routeName: r.routeName }} icon={r.isCircular ? "loop" : "line"} />
                    <span className="pn-cell__text">
                      <span className="pn-cell__title">{r.routeName}</span>
                      <span className="pn-cell__sub">
                        Stop {r.seq} · {servingDirection(r.direction)}
                      </span>
                      <span className="pn-cell__sub pn-cell__sub--gold">
                        {r.verification === "verified" ? "Verified" : "Unverified"}
                      </span>
                    </span>
                    <ChevronRight />
                  </Link>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="pn-section">
          <button
            type="button"
            className="pn-disclosure"
            aria-expanded={nearbyOpen}
            aria-controls={`${uid}-nearby`}
            onClick={() => setNearbyOpen((o) => !o)}
          >
            <span>Passing nearby · not confirmed to stop</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <div id={`${uid}-nearby`} hidden={!nearbyOpen} className="pn-disclosure-panel">
            <ul className="pn-group">
              {passingNearby.length === 0 ? (
                <li className="pn-cell pn-cell--empty">Not yet surveyed</li>
              ) : (
                passingNearby.map((r) => (
                  <li key={r.routeCode}>
                    <Link href={`/app/routes/${encodeURIComponent(r.routeCode)}`} className="pn-cell">
                      <LoopChip leg={r} icon="line" />
                      <span className="pn-cell__text">
                        <span className="pn-cell__title">{r.routeName}</span>
                      </span>
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </div>
        </section>

        <dl className="pn-group" style={{ margin: 0 }}>
          <div className="pn-kv" style={{ borderBottom: "1px solid var(--pn-sep)" }}>
            <dt className="pn-kv__key">Curb side</dt>
            <dd className="pn-kv__value" style={{ margin: 0 }}>{stop.curbSide ?? "Not surveyed"}</dd>
          </div>
          <div className="pn-kv">
            <dt className="pn-kv__key">Sign</dt>
            <dd className="pn-kv__value" style={{ margin: 0 }}>Not verified</dd>
          </div>
        </dl>
        {referencePhoto ? <ReferencePhoto photo={referencePhoto} stop /> : null}
        <StopStreetView key={stop.id} lat={stop.lat} lng={stop.lng} name={stopDisplayName(stop.name, stop.source.code)} />

      </main>
    </DetailPanel>
  );
}
