"use client";

// "Nearby stops": the stop pins nearest the map centre as links, the non-map path to the same
// pins (canvas pins cannot take keyboard focus). Rows follow Components · List cells (candidate
// ring, name, "Mapped candidate · not yet verified").

import Link from "next/link";
import type { StopPin } from "@/domain/api/schemas";
import type { LatLng } from "@/domain/geo/types";
import { nearestStopGroups } from "@/domain/network/present";
import { stopLabel } from "@/domain/trip/present";
import { CandidateRing, ChevronRight } from "@/ui/detail/detail-frame";

export const NEARBY_LIMIT = 8;

type Props = {
  stops: readonly StopPin[];
  center: LatLng;
  status: "idle" | "loading" | "ready" | "error";
  truncated: boolean;
  /** Called with the stop path when a row is followed (lets "Show on map" go back in history). */
  onOpen?: (path: string) => void;
};

export function NearbyStops({ stops, center, status, truncated, onOpen }: Props) {
  // Pins at exactly the same point (one source point listed in two layers) share one row.
  const nearest = nearestStopGroups(stops, center, NEARBY_LIMIT);
  let empty: string | null = null;
  if (nearest.length === 0) {
    empty =
      status === "error"
        ? "Mapped stops could not be loaded. Move the map to try again."
        : status === "ready"
          ? "No mapped stops in this part of the map."
          : "Loading mapped stops…";
  }
  return (
    <section className="pn-nearby" aria-labelledby="pn-nearby-title" data-testid="nearby-stops">
      <h2 id="pn-nearby-title" className="pn-section-title">
        Nearby stops
      </h2>
      <p className="pn-nearby__hint">Mapped candidates near the map centre. Not yet verified; tap a pin or a row for its source.</p>
      {empty ? (
        <p className="pn-nearby__empty">{empty}</p>
      ) : (
        <ul className="pn-nearby__list">
          {nearest.map((group) => {
            const s = group[0]!;
            const routeCodes = [...new Set(group.flatMap((p) => p.routeCodes))];
            const layers = group
              .map((p) => (p.source.layer ? `${p.source.layer}${group.length > 1 && p.source.code ? ` (${p.source.code})` : ""}` : null))
              .filter((l): l is string => l !== null);
            return (
              <li key={s.id}>
                <Link href={`/app/stops/${s.id}`} className="pn-nearby__cell" onClick={() => onOpen?.(`/app/stops/${s.id}`)}>
                  <CandidateRing size={30} onRoute={routeCodes.length > 0} />
                  <span className="pn-nearby__text">
                    <strong>{stopLabel(s.name, s.source.code)}</strong>
                    <span className="pn-nearby__sub">
                      Mapped candidate · not yet verified
                      {routeCodes.length > 0 ? ` · on provisional ${routeCodes.join(", ")}` : ""}
                    </span>
                    {layers.length > 0 ? (
                      <span className="pn-nearby__layer">{group.length > 1 ? `Same point in ${layers.join(" · ")}` : layers[0]}</span>
                    ) : null}
                  </span>
                  <ChevronRight />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {truncated ? <p className="pn-nearby__hint">Zoom in to see every pin in this area.</p> : null}
    </section>
  );
}
