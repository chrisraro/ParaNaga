"use client";

// Route detail (artboard RouteDetail) for one route of the approved plan, from
// GET /api/v1/routes/:code. Documented routes show the legal plan's street order; Loops A and B
// also list their provisional stops (pin order) and the unconfirmed trial revision. Fares are an
// estimate range from the reported rules or "Unknown"; service hours were not observed.

import Link from "next/link";
import { useState, type KeyboardEvent } from "react";
import { useNetworkResource } from "@/client/network/use-network-resource";
import { routeDetailSchema, type RouteDetail } from "@/domain/api/schemas";
import {
  allocationText,
  directionLabels,
  routeFareTile,
  routeGroupText,
  sourcesLine,
  streetNote,
  trialNoticeText,
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
import { LoopChip } from "@/ui/trip/trip-parts";

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
  const { route, variants, trials, fareEvidence, sources, revision } = data;
  const heading = useFocusOnMount<HTMLHeadingElement>(true);
  const [direction, setDirection] = useState<Direction>("inbound");

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

  const pickDirection = (next: Direction) => setDirection(next);
  const onSegKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const next: Direction = direction === "inbound" ? "outbound" : "inbound";
    setDirection(next);
    document.getElementById(`pn-dir-${next}`)?.focus();
  };

  return (
    <DetailPanel title="Route" testId="route-detail">
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
            <span className="pn-detail__caption">Signboard not yet verified</span>
          </div>
        </div>

        <div role="note" className="pn-note pn-note--small" data-testid="route-partial">
          <WarnIcon size={18} />
          <p>
            <strong>Partial data.</strong>{" "}
            {provisional
              ? "Shape not yet surveyed. Stops are mapped candidates in pin order, not reviewed."
              : "Shape not yet surveyed and stops not reviewed. Showing the legal plan's street order."}
          </p>
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

        {twoWay ? (
          <div role="radiogroup" aria-label="Direction" className="pn-seg">
            {(["inbound", "outbound"] as const).map((d) => (
              <button
                key={d}
                id={`pn-dir-${d}`}
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
          <section className="pn-section" aria-labelledby="pn-streets-title">
            <h2 id="pn-streets-title" className="pn-section__title">
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
          <section key={i} className="pn-section" aria-labelledby={`pn-structure-${i}`} data-testid="extra-structure">
            <h2 id={`pn-structure-${i}`} className="pn-section__title">
              Street order · structure {i + 2} (also in the source)
            </h2>
            <StreetList streets={streets} circuit={false} label={`Street order, structure ${i + 2}`} />
          </section>
        ))}
        {structures.length > 0 ? (
          <p className="pn-footnote">
            The source lists {structures.length + 1} structures for this route; they are shown separately and not merged.
            {route.normalizationNote ? ` ${route.normalizationNote}` : ""}
          </p>
        ) : null}

        {trials.map((trial) => (
          <section key={trial.variantId} className="pn-section" aria-labelledby={`pn-trial-${trial.variantId}`} data-testid="trial-notice">
            <div role="note" className="pn-note pn-note--small">
              <WarnIcon size={18} />
              <p id={`pn-trial-${trial.variantId}`}>{trialNoticeText(trial, sources)}</p>
            </div>
            {trial.legalStreets.circuit ? (
              <StreetList streets={trial.legalStreets.circuit} circuit label="Trial street order" />
            ) : null}
          </section>
        ))}

        {ordered.map((variant) => (
          <section key={variant.variantId} className="pn-section" aria-labelledby={`pn-stops-${variant.variantId}`}>
            <h2 id={`pn-stops-${variant.variantId}`} className="pn-section__title">
              {variant.evidenceLevel === "provisional" ? "Provisional stops" : "Stops"} · {variant.stops.length} in pin order
            </h2>
            {variant.direction === "clockwise" || variant.direction === "counterclockwise" ? (
              <p className="pn-footnote">Direction: {directionText(variant.direction, "long")}. Mapped candidates, not verified.</p>
            ) : null}
            <ol className="pn-group" data-testid="route-stops">
              {variant.stops.map((s) => (
                <li key={`${s.seq}:${s.id}`}>
                  <Link href={`/app/stops/${s.id}`} className="pn-cell" style={{ minHeight: 52 }}>
                    <CandidateRing size={26} onRoute />
                    <span className="pn-cell__text">
                      <span className="pn-cell__title">{stopLabel(s.name, s.source.code)}</span>
                      <span className="pn-cell__sub pn-cell__sub--gold">Stop {s.seq} · Mapped candidate</span>
                    </span>
                    <ChevronRight />
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        ))}

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
        <p className="pn-soon">Corrections open soon</p>
      </main>
    </DetailPanel>
  );
}
