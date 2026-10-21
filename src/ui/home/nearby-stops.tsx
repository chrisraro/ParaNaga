"use client";

// "Nearby stops": the stop pins nearest the map centre as links, the non-map path to the same
// pins (canvas pins cannot take keyboard focus). Rows follow Components · List cells (candidate
// ring, name, "Mapped candidate · not yet verified").

import Link from "next/link";
import type { StopPin } from "@/domain/api/schemas";
import type { LatLng } from "@/domain/geo/types";
import { nearestStopGroups } from "@/domain/network/present";
import { stopLabel } from "@/domain/trip/present";
import { useT } from "@/i18n/provider";
import { CandidateRing, ChevronRight } from "@/ui/detail/detail-frame";

export const NEARBY_LIMIT = 8;

type Props = {
  stops: readonly StopPin[];
  center: LatLng;
  status: "idle" | "loading" | "ready" | "error";
  truncated: boolean;
  title?: string;
  /** Called with the stop path when a row is followed (lets "Show on map" go back in history). */
  onOpen?: (path: string) => void;
};

export function NearbyStops({ stops, center, status, truncated, title, onOpen }: Props) {
  const t = useT();
  const home = t.home;
  // Pins at exactly the same point (one source point listed in two layers) share one row.
  const nearest = nearestStopGroups(stops, center, NEARBY_LIMIT);
  let empty: string | null = null;
  if (nearest.length === 0) {
    empty =
      status === "error"
        ? home.stopsError
        : status === "ready"
          ? home.stopsNone
          : home.stopsLoading;
  }
  return (
    <section className="pn-nearby" aria-labelledby="pn-nearby-title" data-testid="nearby-stops">
      <h2 id="pn-nearby-title" className="pn-section-title">
        {title ?? home.nearbyStops}
      </h2>
      <p className="pn-nearby__hint">{home.mappedNotVerified}</p>
      {empty ? (
        <p className="pn-nearby__empty">{empty}</p>
      ) : (
        <ul className="pn-nearby__list">
          {nearest.map((group) => {
            const s = group[0]!;
            const routeCodes = [...new Set(group.flatMap((p) => p.routeCodes))];
            return (
              <li key={s.id}>
                <Link href={`/app/stops/${s.id}`} className="pn-nearby__cell" onClick={() => onOpen?.(`/app/stops/${s.id}`)}>
                  <CandidateRing size={30} onRoute={routeCodes.length > 0} />
                  <span className="pn-nearby__text">
                    <strong>{stopLabel(s.name, s.source.code, t.trip)}</strong>
                    <span className="pn-nearby__sub">
                      {routeCodes.length > 0 ? home.mappedCandidateRoutes(routeCodes.join(", ")) : home.mappedCandidate}
                    </span>
                  </span>
                  <ChevronRight />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {truncated ? <p className="pn-nearby__hint">{home.zoomIn}</p> : null}
    </section>
  );
}
