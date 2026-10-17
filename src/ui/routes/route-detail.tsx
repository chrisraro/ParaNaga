"use client";

// Route detail (artboard RouteDetail) for one route of the approved plan, from
// GET /api/v1/routes/:code. Documented routes show the legal plan's street order; Loops A and B
// also list their provisional stops (pin order) and the unconfirmed trial revision. Fares are an
// estimate range from the reported rules or "Unknown"; service hours were not observed.

import Link from "next/link";
import { ReportLink } from "@/ui/report/report-link";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useLines } from "@/client/network/use-lines";
import { useNetworkResource } from "@/client/network/use-network-resource";
import { routeDetailSchema, type RouteDetail } from "@/domain/api/schemas";
import { decodePolyline } from "@/domain/geo/polyline";
import { cooperativeLabel } from "@/domain/modes/fleet";
import {
  allocationText,
  directionLabels,
  routeFareTile,
  routeGroupText,
  streetNote,
  vehicleTile,
} from "@/domain/network/present";
import { directionText, routeChipLabel, stopLabel } from "@/domain/trip/present";
import {
  CandidateRing,
  ChevronRight,
  DetailError,
  DetailLoading,
  DetailNotFound,
  DetailPanel,
  WarnIcon,
  useFocusOnMount,
} from "@/ui/detail/detail-frame";
import { noteView } from "@/domain/trip/option-notes";
import { LineNotesView } from "@/ui/map/layers-sheet";
import { RouteNote } from "@/ui/trip/route-note";
import { lineNotes, routeDirectionPath } from "@/ui/map/line-rules";
import { NagaMap } from "@/ui/map/naga-map";
import { SOURCES_HREF } from "@/ui/help/sources-href";
import { LoopChip } from "@/ui/trip/trip-parts";

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function RouteDetailScreen({ code }: { code: string }) {
  const resource = useNetworkResource(`/api/v1/routes/${encodeURIComponent(code)}`, routeDetailSchema);
  if (resource.status === "loading") return <DetailLoading title="Route" />;
  if (resource.status === "not_found") return <DetailNotFound what="route" />;
  if (resource.status === "error") return <DetailError title="Route" offline={resource.offline} onRetry={resource.retry} />;
  return <RouteDetailView data={resource.data} />;
}

function StreetList({ streets, circuit, label, testId }: { streets: readonly string[]; circuit: boolean; label: string; testId?: string }) {
  return (
    <ol className="pn-streets" aria-label={label} data-testid={testId}>
      {streets.map((name, i) => (
        <li key={`${i}:${name}`} className="pn-street">
          <span className="pn-street__rail" aria-hidden="true">
            <span className="pn-street__node" />
          </span>
          <span className="pn-street__text">
            <span className="pn-street__name">{name}</span>
            <span className="pn-street__note">{streetNote(i, streets.length, circuit)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function DocIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M6 4h9l3 3v13H6z" />
      <path d="M9 11h6M9 15h6" />
    </svg>
  );
}

function PinsIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

type Direction = "inbound" | "outbound";

export function RouteDetailView({ data }: { data: RouteDetail }) {
  const { route, variants, trials, fareEvidence } = data;
  const heading = useFocusOnMount<HTMLHeadingElement>(true);
  const [direction, setDirection] = useState<Direction>("inbound");
  // Ids are per instance: Next keeps a left page mounted (hidden), so two route panels can coexist.
  const uid = useId();
  const dirButtons = useRef<Record<Direction, HTMLButtonElement | null>>({ inbound: null, outbound: null });

  const linesState = useLines(data.revision.revisionId);
  const { lines } = linesState;

  const group = routeGroupText(route.groupNumber, route.modeCode);
  const fare = routeFareTile(fareEvidence.rules);
  const vehicle = vehicleTile(route.modeCode);
  const labels = directionLabels(route.name);
  const { inbound, outbound, circuit } = route.legalStreets;
  const twoWay = inbound !== null && outbound !== null;
  const shown = twoWay ? (direction === "inbound" ? inbound : outbound) : (circuit ?? inbound ?? outbound);
  const isCircuit = !twoWay && circuit !== null;
  const ordered = variants.filter((v) => v.stops.length > 0);
  const provisional = route.hasProvisionalStops;
  const structures = route.additionalSourceStructures;
  // Stop-sign letters and names on file (e.g. "E"); reviewed aliases, still unverified on the street.
  const signs = data.aliases.filter((a) => a.kind === "signboard" && !a.isHistorical).map((a) => a.alias);

  // The selected direction's own line only: an untraced direction never borrows the other one's.
  const { line: activeLine, untraced } = useMemo(
    () => routeDirectionPath(lines, route.code, twoWay, direction),
    [lines, route.code, twoWay, direction],
  );
  const activeNotes = useMemo(() => (activeLine ? lineNotes(activeLine) : null), [activeLine]);
  const pathStatus = activeLine
    ? activeLine.label
    : linesState.status === "loading"
      ? "Loading path…"
      : linesState.status === "skipped"
        ? "Path off in low-data mode"
        : linesState.status === "ready"
          ? (untraced?.message ?? "Path not traced")
          : "Path unavailable";

  const activeCoords = useMemo(() => {
    if (!activeLine) return null;
    return decodePolyline(activeLine.encoded);
  }, [activeLine]);

  const pickDirection = (next: Direction) => setDirection(next);
  const onSegKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const next: Direction = direction === "inbound" ? "outbound" : "inbound";
    setDirection(next);
    dirButtons.current[next]?.focus();
  };

  return (
    <DetailPanel title="Route" sources={`${SOURCES_HREF}?route=${encodeURIComponent(route.code)}`} testId="route-detail">
      <main className="pn-detail__main pn-detail-in" style={{ gap: 12 }}>
        <div className="pn-detail__stack">
          <div className="pn-detail__row">
            <LoopChip leg={{ routeCode: route.code, routeName: route.name }} icon={isCircuit ? "loop" : "line"} />
            <span className="pn-detail__caption">{[routeChipLabel(route.code, route.name) === route.code ? null : route.code, group].filter(Boolean).join(" · ")}</span>
          </div>
          <h1 ref={heading} tabIndex={-1} className="pn-detail__title">
            {route.name}
          </h1>
          <div className="pn-detail__row">
            <span className="pn-badge pn-badge--evidence" data-testid="route-evidence">
              {provisional ? <PinsIcon /> : <DocIcon />}
              {provisional ? "Provisional stops" : "Documented only"}
            </span>
            <span className="pn-detail__caption" data-testid="route-signs">
              {signs.length > 0 ? `Also signed ${signs.join(" · ")} · not yet verified` : "Signboard not yet verified"}
            </span>
          </div>
        </div>

        <div role="note" className="pn-note pn-note--small" data-testid="route-partial">
          <WarnIcon size={18} />
          <p>
            <strong>Partial data.</strong>{" "}
            {provisional
              ? "Shape and stops unverified."
              : "Shape and stops unverified. Street order from the plan."}
          </p>
        </div>

        <div className="pn-route-map-container" style={{ borderRadius: 12, overflow: "hidden", border: "1px solid var(--pn-border, #E2E8F0)" }}>
          <div style={{ height: 240, position: "relative" }} data-testid="route-map">
            <NagaMap
              routeLines={activeLine ? [activeLine] : []}
              selectedRouteCode={route.code}
              showRouteChevrons={true}
              fitBoundsCoords={activeCoords}
              label={`Map of ${route.name}`}
            />
          </div>
          <div className="pn-route-map-status" style={{ padding: "8px 12px", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--pn-surface, #F8FAFC)" }} data-testid="route-map-status">
            <span data-testid="route-path-status">{pathStatus}</span>
            {activeLine ? (
              <span className="pn-route-map-badge" style={{ fontSize: 11, fontWeight: 600, opacity: 0.8 }} data-testid="route-trace-badge">
                {activeLine.status === "ok" ? "Trace: ok" : `Trace: flagged (${activeLine.flagReason})`}
              </span>
            ) : null}
          </div>
          {activeNotes ? (
            <div className="pn-route-map-notes" data-testid="route-map-notes">
              <LineNotesView notes={activeNotes} testIdPrefix="route-map" />
            </div>
          ) : null}
        </div>

        <dl className="pn-tiles">
          <div className="pn-tile" data-testid="fare-tile">
            <dt>Fare</dt>
            <dd>
              <span className="pn-tile__value">{fare.value}</span>
              <span className="pn-tile__note">{fare.note}</span>
            </dd>
          </div>
          <div className="pn-tile">
            <dt>Service</dt>
            <dd>
              <span className="pn-tile__value">Unknown</span>
              <span className="pn-tile__note">Not observed</span>
            </dd>
          </div>
          <div className="pn-tile">
            <dt>Vehicle</dt>
            <dd>
              <span className="pn-tile__value">{vehicle.value}</span>
              <span className="pn-tile__note">{vehicle.note}</span>
            </dd>
          </div>
        </dl>
        {fare.detail ? <p className="pn-footnote">Fare: {fare.detail}.</p> : null}

        {data.notes.length > 0 ? (
          <section className="pn-section" aria-labelledby={`${uid}-notes`} data-testid="route-notes">
            <h2 id={`${uid}-notes`} className="pn-section__title">
              Notes
            </h2>
            <ul className="pn-route-notes">
              {data.notes.map((n) => (
                <li key={n.text}>
                  <RouteNote note={noteView(n.text, data.notes)} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {twoWay ? (
          <div role="radiogroup" aria-label="Direction" className="pn-seg">
            {(["inbound", "outbound"] as const).map((d) => (
              <button
                key={d}
                ref={(el) => {
                  dirButtons.current[d] = el;
                }}
                type="button"
                role="radio"
                aria-checked={direction === d}
                tabIndex={direction === d ? 0 : -1}
                className="pn-seg__btn"
                onClick={() => pickDirection(d)}
                onKeyDown={onSegKey}
              >
                {labels[d]}
              </button>
            ))}
          </div>
        ) : null}

        {shown ? (
          <section className="pn-section" aria-labelledby={`${uid}-streets`}>
            <h2 id={`${uid}-streets`} className="pn-section__title">
              {isCircuit ? "Street order · circuit" : "Street order"}
              {structures.length > 0 ? " · structure 1" : ""}
            </h2>
            <StreetList
              streets={shown}
              circuit={isCircuit}
              label={twoWay ? `Street order ${labels[direction].toLowerCase()}` : "Street order of the circuit"}
              testId="street-order"
            />
          </section>
        ) : (
          <p className="pn-footnote">Street order not recorded.</p>
        )}

        {structures.map((streets, i) => (
          <section key={i} className="pn-section" aria-labelledby={`${uid}-structure-${i}`} data-testid="extra-structure">
            <h2 id={`${uid}-structure-${i}`} className="pn-section__title">
              Street order · structure {i + 2}
            </h2>
            <StreetList streets={streets} circuit={false} label={`Street order, structure ${i + 2}`} />
          </section>
        ))}

        {trials.map((trial) => (
          <section key={trial.variantId} className="pn-section" aria-labelledby={`${uid}-trial-${trial.variantId}`} data-testid="trial-notice">
            <div role="note" className="pn-note pn-note--small">
              <WarnIcon size={18} />
              <p id={`${uid}-trial-${trial.variantId}`}>Trial · permanence unconfirmed</p>
            </div>
            {trial.legalStreets.circuit ? (
              <StreetList streets={trial.legalStreets.circuit} circuit label="Trial street order" />
            ) : null}
          </section>
        ))}

        <section className="pn-section" aria-labelledby={`${uid}-fleet`} data-testid="route-fleet-section">
          <h2 id={`${uid}-fleet`} className="pn-section__title">
            Fleet
          </h2>
          <p className="pn-detail__caption" data-testid="route-fleet-label" style={{ fontWeight: 600, margin: "4px 0 8px" }}>
            {route.fleet.label}
          </p>
          <div className="pn-group" data-testid="fleet-rows">
            {route.fleet.classes.map((r, i) => {
              const label = r.label;

              return (
                <div key={i} className="pn-cell" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4, padding: "10px 14px" }} data-testid="fleet-row">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", justifyContent: "space-between" }}>
                    <strong className="pn-cell__title">{label}</strong>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="pn-section" aria-labelledby={`${uid}-cooperatives`} data-testid="route-cooperatives-section">
          <h2 id={`${uid}-cooperatives`} className="pn-section__title">
            Cooperatives
          </h2>
          {data.cooperatives.length === 0 ? (
            <p className="pn-footnote">No cooperatives on file for this corridor.</p>
          ) : (
            <ul className="pn-group" style={{ listStyle: "none", padding: 0, margin: 0 }} data-testid="cooperatives-list">
              {data.cooperatives.map((c) => {
                const label = cooperativeLabel(c.basis, c.reportedOn);
                return (
                  <li key={c.name} className="pn-cell" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4, padding: "10px 14px" }} data-testid="cooperative-row">
                    <strong className="pn-cell__title">{c.name}</strong>
                    <p className="pn-footnote" style={{ margin: 0 }}>
                      {label}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="pn-footnote" style={{ marginTop: 6 }} data-testid="cooperatives-footnote">
            Leaders&apos; names not shown.
          </p>
        </section>

        {ordered.map((variant) => (
          <section key={variant.variantId} className="pn-section" aria-labelledby={`${uid}-stops-${variant.variantId}`}>
            <h2 id={`${uid}-stops-${variant.variantId}`} className="pn-section__title">
              Stops · {variant.stops.length}
            </h2>
            {variant.direction === "clockwise" || variant.direction === "counterclockwise" ? (
              <p className="pn-footnote">{capitalised(directionText(variant.direction, "short")!)} · mapped, unverified</p>
            ) : null}
            <ol className="pn-group" data-testid="route-stops">
              {variant.stops.map((s) => (
                <li key={`${s.seq}:${s.id}`}>
                  <Link href={`/app/stops/${s.id}`} className="pn-cell" style={{ minHeight: 52 }}>
                    <CandidateRing size={26} onRoute />
                    <span className="pn-cell__text">
                      <span className="pn-cell__title">{stopLabel(s.name, s.source.code)}</span>
                      <span className="pn-cell__sub pn-cell__sub--gold">Stop {s.seq}</span>
                    </span>
                    <ChevronRight />
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        ))}

        <p className="pn-footnote" data-testid="route-allocation">
          {allocationText(route)}
        </p>
        <ReportLink entityType="route" entityId={route.code} entityLabel={route.name} />
      </main>
    </DetailPanel>
  );
}
