"use client";

// Stop detail (artboard StopDetail) for one mapped stop pin, from GET /api/v1/stops/:id.
// Shows the source pin verbatim (layer, code, coordinates, raw description), the provisional
// routes whose pin order lists it, and honest unknowns where the artboard has survey data.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useNetworkResource } from "@/client/network/use-network-resource";
import { stopDetailSchema, type StopDetail } from "@/domain/api/schemas";
import {
  latestRetrievedOn,
  sharedLayers,
  snapshotSourceText,
  sourceCoordinatesText,
  stopStatusBadge,
} from "@/domain/network/present";
import { directionText } from "@/domain/trip/present";
import { cameFromInsideApp, useAppFrame } from "@/ui/app-shell/app-frame-context";
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
} from "@/ui/detail/detail-frame";
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
  const router = useRouter();
  if (!frame) return null;
  return (
    <button
      type="button"
      className="pn-detail__round"
      aria-label="Show on map"
      onClick={() => {
        frame.showOnMap({ lat, lng });
        // Opened from the map in this session: go back to it (no extra history entry). Otherwise
        // (a shared link, or reached from another panel) open the map.
        if (cameFromInsideApp() && frame.openedFromHome()) router.back();
        else router.push("/app");
      }}
    >
      <MapIcon />
    </button>
  );
}

/** A source value in quotes, verbatim; "empty" and "none" keep an empty string and a missing value apart. */
function quoted(value: string | null): string {
  if (value === null) return "none";
  return value === "" ? "empty" : `“${value}”`;
}

function servingDirection(direction: StopDetail["servingRoutes"][number]["direction"]): string {
  if (direction === "clockwise" || direction === "counterclockwise") return directionText(direction, "long")!;
  return direction;
}

export function StopDetailView({ data }: { data: StopDetail }) {
  const { stop, sourceRecords, sharedCoordinate, servingRoutes, passingNearby, sourceMap, revision } = data;
  const heading = useFocusOnMount<HTMLHeadingElement>(true);
  const [nearbyOpen, setNearbyOpen] = useState(false);
  const uid = useId(); // per instance: a hidden previous stop panel may still be mounted
  const layers = sharedLayers(sharedCoordinate);
  const onRoute = servingRoutes.length > 0;

  return (
    <DetailPanel title="Stop" action={<ShowOnMap lat={stop.lat} lng={stop.lng} />} testId="stop-detail">
      <main className="pn-detail__main pn-detail-in">
        <div className="pn-detail__head">
          <CandidateRing size={40} onRoute={onRoute} />
          <div className="pn-detail__head-text">
            <h1 ref={heading} tabIndex={-1} className="pn-detail__title">
              {stop.name}
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
            <strong>Not verified for navigation.</strong> {snapshotSourceText(latestRetrievedOn(sourceRecords))}
          </p>
        </div>

        {sourceRecords.map((record, i) => (
          <section key={`${record.layer}:${record.code}:${i}`} className="pn-card" aria-label={sourceRecords.length > 1 ? `Source record ${i + 1}` : "Source record"} data-testid="source-record">
            <span className="pn-card__label">{sourceRecords.length > 1 ? `Source record ${i + 1} of ${sourceRecords.length}` : "Source record"}</span>
            <p className="pn-card__text">
              {record.layer} · {record.code ? <>code <span className="pn-mono" data-testid="source-code">{record.code}</span></> : "no code"}
            </p>
            <p className="pn-card__mono pn-mono" data-testid="source-coordinates">
              {sourceCoordinatesText(record)}
            </p>
            {record.label !== stop.name ? (
              <p className="pn-card__sub">Raw label: {quoted(record.label)}</p>
            ) : null}
            <p className="pn-card__sub" data-testid="source-description">
              Raw description: {quoted(record.description)}
              {i === 0 && layers.length > 0 ? (
                <>
                  {" · same point also listed in "}
                  {sharedCoordinate.map((s, j) => (
                    <span key={s.stopId}>
                      {j > 0 ? ", " : null}
                      <Link className="pn-inline-link" href={`/app/stops/${s.stopId}`}>
                        {s.source.layer ?? "another layer"}
                        {s.source.code ? ` (${s.source.code})` : ""}
                      </Link>
                    </span>
                  ))}
                </>
              ) : null}
            </p>
          </section>
        ))}

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
                        {r.evidenceLevel === "provisional" ? "Provisional stop" : "Stop"} {r.seq} · {servingDirection(r.direction)}
                      </span>
                      <span className="pn-cell__sub pn-cell__sub--gold">
                        {r.verification === "verified" ? "Verified route" : "Unverified route"} · boarding and alighting not yet surveyed
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
            <dt className="pn-kv__key">Curb side · toward</dt>
            <dd className="pn-kv__value" style={{ margin: 0 }}>{stop.curbSide ?? "Not yet surveyed"}</dd>
          </div>
          <div className="pn-kv">
            <dt className="pn-kv__key">Photo · sign text</dt>
            <dd className="pn-kv__value" style={{ margin: 0 }}>Photo pending</dd>
          </div>
        </dl>

        <p className="pn-soon">Verification opens soon</p>

        <p className="pn-footnote">
          {sourceMap?.ownerDisplayName
            ? `Pins from a public My Maps map whose owner is shown as “${sourceMap.ownerDisplayName}”${sourceMap.ownerIdentityVerified ? "" : " (identity not verified)"}. `
            : "Pins from a public My Maps map. "}
          Transport data revision {revision.label}.
        </p>
      </main>
    </DetailPanel>
  );
}
