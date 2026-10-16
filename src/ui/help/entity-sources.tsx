"use client";

// The per-item source details that used to sit on the working screens, shown on Sources and credits
// when a detail screen's "Sources" link names the item: ?stop=<id> (the pin's source records and the
// My Maps snapshot), ?route=<code> (fleet, cooperative and plan sources), ?osm=<type>/<id>&v=<n> (the
// OpenStreetMap object). Nothing here is a verification: the raw values are shown as they were
// recorded.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useNetworkResource } from "@/client/network/use-network-resource";
import { routeDetailSchema, sourceListSchema, stopDetailSchema, terminalDetailSchema, type RouteDetail, type StopDetail, type TerminalDetail } from "@/domain/api/schemas";
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
import { osmObjectUrl, osmSnapshotDate, terminalEvidenceLabel } from "@/domain/places/place-detail";
import { isRouteMode } from "@/domain/places/terminals";
import { modeName } from "@/domain/modes/fleet";

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
  if (resource.status === "not_found") return <NothingFound />;
  if (resource.status !== "ready") return <NothingFound message="Couldn’t load that item’s sources." />;
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
        <ul className="pn-footnote pn-source-list" data-testid="entity-fleet-sources">
          {route.fleet.classes.map((c, i) => (
            <li key={i}>
              {c.label}
              {c.sourceCodes.length > 0 ? `: ${c.sourceCodes.map((code) => `${code} ${titleOf(code)}`).join("; ")}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {data.cooperatives.length > 0 ? (
        <ul className="pn-footnote pn-source-list" data-testid="entity-cooperative-sources">
          {data.cooperatives.map((c) => (
            <li key={c.name}>
              {c.name}: {cooperativeLabel(c.basis, c.reportedOn)}
              {c.sourceCodes.length > 0 ? ` · ${c.sourceCodes.map(titleOf).join(" · ")}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {data.fareEvidence.rules.length > 0 ? (
        <ul className="pn-footnote pn-source-list" data-testid="entity-fare-sources">
          {data.fareEvidence.rules.map((r) => (
            <li key={r.code}>
              Fare rule {r.code}
              {r.sourceCodes.length > 0 ? `: ${r.sourceCodes.map((code) => `${code} ${titleOf(code)}`).join("; ")}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {route.fleet.classes.some((c) => c.status === "reported_not_confirmed") ? (
        <p className="pn-footnote">Private guide, Oct 2025 · user report, unverified (a fleet class that is reported, not confirmed).</p>
      ) : null}
      <p className="pn-footnote" data-testid="route-allocation">
        {allocationText(route)} {sourcesLine(route.sourceCodes, revision.label)}
      </p>
      {sources.length > 0 ? (
        <ul className="pn-footnote pn-source-list">
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
  if (resource.status === "not_found") return <NothingFound />;
  if (resource.status !== "ready") return <NothingFound message="Couldn’t load that item’s sources." />;
  return <RouteSources data={resource.data} />;
}

const NOTHING_FOUND = "Nothing found for that link.";

function NothingFound({ message = NOTHING_FOUND }: { message?: string }) {
  return (
    <p role="status" className="pn-footnote" data-testid="entity-sources-none">
      {message}
    </p>
  );
}

/** Titles from the register, "S33 title" for each code; the code alone until it loads or when unlisted. */
function useCodesText(): (codes: readonly string[]) => string {
  const register = useNetworkResource("/api/v1/sources", sourceListSchema);
  return (codes) =>
    codes
      .map((c) => {
        const title = register.status === "ready" ? register.data.sources.find((s) => s.code === c)?.title : undefined;
        return title ? `${c} ${title}` : c;
      })
      .join("; ");
}

function OsmObject({ type, id, version, snapshot }: { type: "node" | "way" | "relation"; id: string; version: string | null; snapshot: string | null }) {
  const date = snapshot ? osmSnapshotDate(snapshot) : null;
  return (
    <section className="pn-section" aria-labelledby="entity-sources-title" data-testid="entity-sources">
      <h2 id="entity-sources-title" className="pn-section__title">
        This place
      </h2>
      <p className="pn-footnote" data-testid="entity-osm-object">
        OSM snapshot {date ?? "date not recorded"} · object {type}/{id}
        {version ? ` v${version}` : ""}.{" "}
        <a className="pn-inline-link" href={osmObjectUrl(type, id)} target="_blank" rel="noopener noreferrer" data-testid="place-osm-link">
          View on OpenStreetMap
        </a>
      </p>
      <p className="pn-footnote">Hours, photos and ratings are not shown unless sourced.</p>
    </section>
  );
}

/** A barangay's or a study label's source codes (validated S00 codes), with titles from the register. */
function CodedSources({ codes }: { codes: string[] }) {
  const text = useCodesText();
  return (
    <section className="pn-section" aria-labelledby="entity-sources-title" data-testid="entity-sources">
      <h2 id="entity-sources-title" className="pn-section__title">
        This item
      </h2>
      <p className="pn-footnote" data-testid="entity-coded-sources">
        {text(codes)}
      </p>
    </section>
  );
}

function TerminalSources({ data }: { data: TerminalDetail }) {
  const { terminal } = data;
  const titleOf = (code: string) => data.sources.find((s) => s.code === code)?.title;
  const codes = (list: readonly string[]) => list.map((c) => (titleOf(c) ? `${c} ${titleOf(c)}` : c)).join("; ") || "none on file";
  const c = terminal.coordinate;
  return (
    <section className="pn-section" aria-labelledby="entity-sources-title" data-testid="entity-sources">
      <h2 id="entity-sources-title" className="pn-section__title">
        This terminal: {terminal.name}
      </h2>
      <ul className="pn-footnote pn-source-list" data-testid="entity-terminal-sources">
        <li>
          Address: {terminalEvidenceLabel(terminal.evidenceStatus)} · {codes(terminal.sourceCodes)}
        </li>
        {terminal.modes.filter(isRouteMode).map((m) => (
          <li key={m}>
            {modeName(m)}: {codes(terminal.modeSources[m] ?? [])}
          </li>
        ))}
        {data.regionalServices.map((s) => (
          <li key={s.code}>
            {s.destination} ({s.code}): {codes(s.sourceCodes)}
          </li>
        ))}
        {c ? (
          <li>
            Location: OpenStreetMap object {c.osmType}/{c.osmId}
            {c.osmVersion !== null ? ` v${c.osmVersion}` : ""}
            {c.note ? ` · ${c.note}` : ""}{" "}
            <a className="pn-inline-link" href={osmObjectUrl(c.osmType, String(c.osmId))} target="_blank" rel="noopener noreferrer">
              View on OpenStreetMap
            </a>
          </li>
        ) : null}
      </ul>
      {data.regionalServices.length > 0 ? <p className="pn-footnote">Regional fares are estimates from the 28 Sep 2026 national per-km rates.</p> : null}
    </section>
  );
}

function TerminalSourcesByCode({ code }: { code: string }) {
  const resource = useNetworkResource(`/api/v1/terminals/${encodeURIComponent(code)}`, terminalDetailSchema);
  if (resource.status === "loading") return <p role="status" className="pn-footnote">Loading this terminal’s sources…</p>;
  if (resource.status === "not_found") return <NothingFound />;
  if (resource.status !== "ready") return <NothingFound message="Couldn’t load that item’s sources." />;
  return <TerminalSources data={resource.data} />;
}

const KEYS = ["stop", "route", "terminal", "osm", "src"] as const;

/** What the screen's link asked for, or nothing for the plain register. Raw values are validated, never shown. */
export function EntitySources() {
  const params = useSearchParams();
  const asked = KEYS.find((k) => params.has(k));
  if (!asked) return null;
  const value = params.get(asked) ?? "";
  switch (asked) {
    case "stop":
      return /^[0-9a-fA-F-]{36}$/.test(value) ? <StopSourcesById id={value} /> : <NothingFound />;
    case "route":
      return /^[A-Za-z0-9][A-Za-z0-9-]{0,15}$/.test(value) ? <RouteSourcesByCode code={value} /> : <NothingFound />;
    case "terminal":
      return /^T[0-9]{2}$/.test(value) ? <TerminalSourcesByCode code={value} /> : <NothingFound />;
    case "osm": {
      const m = /^(node|way|relation)\/([0-9]{1,12})$/.exec(value);
      if (!m) return <NothingFound />;
      const v = params.get("v") ?? "";
      const s = params.get("s") ?? "";
      return (
        <OsmObject
          type={m[1] as "node" | "way" | "relation"}
          id={m[2]!}
          version={/^[0-9]{1,6}$/.test(v) ? v : null}
          snapshot={/^OSM-[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s) ? s : null}
        />
      );
    }
    default: {
      const codes = value.split(",");
      return codes.length <= 6 && codes.every((c) => /^S[0-9]{2}$/.test(c)) ? <CodedSources codes={codes} /> : <NothingFound />;
    }
  }
}
