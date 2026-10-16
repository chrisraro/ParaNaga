"use client";

// The per-item source details that used to sit on the working screens, shown on Sources and credits
// when a detail screen's "Sources" link names the item: ?stop=<id> (the pin's source records and the
// My Maps snapshot), ?route=<code> (fleet, cooperative and plan sources), ?osm=<type>/<id>&v=<n> (the
// OpenStreetMap object). Nothing here is a verification: the raw values are shown as they were
// recorded.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useNetworkResource } from "@/client/network/use-network-resource";
import { routeDetailSchema, stopDetailSchema, type RouteDetail, type StopDetail } from "@/domain/api/schemas";
import { cooperativeLabel } from "@/domain/modes/fleet";
import {
  allocationText,
  latestRetrievedOn,
  sharedLayers,
  snapshotSourceText,
  sourceCoordinatesText,
  sourcesLine,
  trialNoticeText,
} from "@/domain/network/present";
import { stopDisplayName } from "@/domain/trip/present";
import { osmObjectUrl } from "@/domain/places/place-detail";

/** A source value in quotes, verbatim; "empty" and "none" keep an empty string and a missing value apart. */
function quoted(value: string | null): string {
  if (value === null) return "none";
  return value === "" ? "empty" : `“${value}”`;
}

function StopSources({ data }: { data: StopDetail }) {
  const { stop, sourceRecords, sharedCoordinate, sourceMap, revision } = data;
  const layers = sharedLayers(sharedCoordinate);
  return (
    <section className="pn-section" aria-labelledby="entity-sources-title" data-testid="entity-sources">
      <h2 id="entity-sources-title" className="pn-section__title">
        This stop: {stopDisplayName(stop.name, stop.source.code)}
      </h2>
      <p className="pn-footnote">{snapshotSourceText(latestRetrievedOn(sourceRecords))}</p>
      {sourceRecords.map((record, i) => (
        <section key={`${record.layer}:${record.code}:${i}`} className="pn-card" aria-label={sourceRecords.length > 1 ? `Source record ${i + 1}` : "Source record"} data-testid="source-record">
          <span className="pn-card__label">{sourceRecords.length > 1 ? `Source record ${i + 1} of ${sourceRecords.length}` : "Source record"}</span>
          <p className="pn-card__text">
            {record.layer} · {record.code ? <>code <span className="pn-mono" data-testid="source-code">{record.code}</span></> : "no code"}
          </p>
          <p className="pn-card__mono pn-mono" data-testid="source-coordinates">
            {sourceCoordinatesText(record)}
          </p>
          {record.label !== stop.name ? <p className="pn-card__sub">Raw label: {quoted(record.label)}</p> : null}
          <p className="pn-card__sub" data-testid="source-description">
            Raw description: {quoted(record.description)}
            {i === 0 && layers.length > 0 ? (
              <>
                {" · same point also listed in "}
                {sharedCoordinate.map((s, j) => (
                  <span key={s.stopId}>
                    {j > 0 ? ", " : null}
                    <Link className="pn-inline-link" href={`/app/help/sources?stop=${s.stopId}`}>
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
      <p className="pn-footnote">
        {sourceMap?.ownerDisplayName
          ? `Pins from a public My Maps map whose owner is shown as “${sourceMap.ownerDisplayName}”${sourceMap.ownerIdentityVerified ? "" : " (identity not verified)"}. `
          : "Pins from a public My Maps map. "}
        Transport data revision {revision.label}.
      </p>
    </section>
  );
}

function StopSourcesById({ id }: { id: string }) {
  const resource = useNetworkResource(`/api/v1/stops/${encodeURIComponent(id)}`, stopDetailSchema);
  if (resource.status === "loading") return <p role="status" className="pn-footnote">Loading this stop’s sources…</p>;
  if (resource.status !== "ready") return null;
  return <StopSources data={resource.data} />;
}

function RouteSources({ data }: { data: RouteDetail }) {
  const { route, trials, sources, revision } = data;
  const titleOf = (code: string) => sources.find((s) => s.code === code)?.title ?? code;
  return (
    <section className="pn-section" aria-labelledby="entity-sources-title" data-testid="entity-sources">
      <h2 id="entity-sources-title" className="pn-section__title">
        This route: {route.name}
      </h2>
      {route.additionalSourceStructures.length > 0 ? (
        <p className="pn-footnote">
          The source lists {route.additionalSourceStructures.length + 1} structures for this route; they are shown separately and not merged.
          {route.normalizationNote ? ` ${route.normalizationNote}` : ""}
        </p>
      ) : null}
      {trials.map((trial) => (
        <p key={trial.variantId} className="pn-footnote">
          {trialNoticeText(trial, sources)}
        </p>
      ))}
      {route.fleet.classes.length > 0 ? (
        <ul className="pn-footnote" style={{ paddingLeft: 18 }} data-testid="entity-fleet-sources">
          {route.fleet.classes.map((c, i) => (
            <li key={i}>
              {c.label}
              {c.sourceCodes.length > 0 ? `: ${c.sourceCodes.map((code) => `${code} ${titleOf(code)}`).join("; ")}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {data.cooperatives.length > 0 ? (
        <ul className="pn-footnote" style={{ paddingLeft: 18 }} data-testid="entity-cooperative-sources">
          {data.cooperatives.map((c) => (
            <li key={c.name}>
              {c.name}: {cooperativeLabel(c.basis, c.reportedOn)}
              {c.sourceCodes.length > 0 ? ` · ${c.sourceCodes.map(titleOf).join(" · ")}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="pn-footnote" data-testid="route-allocation">
        {allocationText(route)} {sourcesLine(route.sourceCodes, revision.label)}
      </p>
      {sources.length > 0 ? (
        <ul className="pn-footnote" style={{ paddingLeft: 18 }}>
          {sources.map((s) => (
            <li key={s.code}>
              {s.code}: {s.title}
              {s.checkedOn ? ` (checked ${s.checkedOn})` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function RouteSourcesByCode({ code }: { code: string }) {
  const resource = useNetworkResource(`/api/v1/routes/${encodeURIComponent(code)}`, routeDetailSchema);
  if (resource.status === "loading") return <p role="status" className="pn-footnote">Loading this route’s sources…</p>;
  if (resource.status !== "ready") return null;
  return <RouteSources data={resource.data} />;
}

function OsmObject({ type, id, version }: { type: "node" | "way" | "relation"; id: string; version: string | null }) {
  return (
    <section className="pn-section" aria-labelledby="entity-sources-title" data-testid="entity-sources">
      <h2 id="entity-sources-title" className="pn-section__title">
        This place
      </h2>
      <p className="pn-footnote">
        OpenStreetMap object {type}/{id}
        {version ? ` v${version}` : ""}.{" "}
        <a className="pn-inline-link" href={osmObjectUrl(type, id)} target="_blank" rel="noopener noreferrer" data-testid="place-osm-link">
          View on OpenStreetMap
        </a>
      </p>
      <p className="pn-footnote">Hours, photos and ratings are not shown unless sourced.</p>
    </section>
  );
}

/** What the screen's link asked for, or nothing for the plain register. */
export function EntitySources() {
  const params = useSearchParams();
  const stop = params.get("stop");
  const route = params.get("route");
  const osm = /^(node|way|relation)\/(\d{1,12})$/.exec(params.get("osm") ?? "");
  if (stop) return <StopSourcesById id={stop} />;
  if (route) return <RouteSourcesByCode code={route} />;
  if (osm) return <OsmObject type={osm[1] as "node" | "way" | "relation"} id={osm[2]!} version={/^\d{1,6}$/.test(params.get("v") ?? "") ? params.get("v") : null} />;
  return null;
}
