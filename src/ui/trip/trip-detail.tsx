"use client";

// Trip detail (artboard TripDetail) inside the home sheet. Ordered legs:
//   Walk ≈ m to <stop> (code) · path not verified
//   Board Loop A at <stop> · direction (from pin order) · "Signboard not yet verified" · ride N stops
//   Get off at <stop> + "Para!" tip (no buzz promise: there is no live tracking)
//   Walk ≈ m to destination · path not verified
// then the fare per ride leg as estimates, and a plain "Corrections open soon." note (no
// correction flow yet, so no link and nothing that looks like a control). The map highlights the boarding/alighting stops only.

import "./trip.css";

import { useEffect, useRef, type ReactNode } from "react";
import type { PlanOptionDto, PlanResponse, RideLegDto, WalkLegDto } from "@/domain/api/plan";
import { directionText, fareChipText, formatDistance, legFareText, routeChipLabel } from "@/domain/trip/present";
import { FareChip, LoopChip, UnverifiedBadge, isNegligibleWalk, planLookups, type PlanLookups } from "./trip-parts";

type Props = {
  data: PlanResponse;
  option: PlanOptionDto;
  onBack: () => void;
};

const CANDIDATE = "Mapped candidate · not yet verified";

function walkTitle(leg: WalkLegDto, lookups: PlanLookups): string {
  const d = formatDistance(leg.estimateMeters);
  if (leg.to.kind === "destination") return `Walk ${d} to your destination`;
  const name = leg.to.stopId ? lookups.stopName(leg.to.stopId, leg.to.name ?? "the stop") : (leg.to.name ?? "the stop");
  return `Walk ${d} to ${name}`;
}

function Marker({ kind }: { kind: "origin" | "board" | "alight" | "destination" | "walk" }) {
  if (kind === "origin" || kind === "walk") {
    return (
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
        <circle cx="11" cy="11" r="7" className={kind === "origin" ? "pn-tl-dot pn-tl-dot--origin" : "pn-tl-dot pn-tl-dot--walk"} strokeWidth="3" />
      </svg>
    );
  }
  if (kind === "board") {
    return (
      <svg width="26" height="26" viewBox="0 0 34 34" aria-hidden="true" focusable="false">
        <circle cx="17" cy="17" r="12" className="pn-tl-dot pn-tl-dot--board" strokeWidth="3" />
      </svg>
    );
  }
  if (kind === "alight") {
    return (
      <svg width="26" height="26" viewBox="0 0 34 34" aria-hidden="true" focusable="false">
        <circle cx="17" cy="17" r="11" className="pn-tl-dot pn-tl-dot--alight" strokeWidth="5" />
      </svg>
    );
  }
  return (
    <svg width="26" height="26" viewBox="0 0 34 34" aria-hidden="true" focusable="false">
      <circle cx="17" cy="17" r="12" className="pn-tl-dot pn-tl-dot--dest" />
      <circle cx="17" cy="17" r="5" fill="#FFFFFF" />
    </svg>
  );
}

type Step = { key: string; marker: Parameters<typeof Marker>[0]["kind"]; rail: "walk" | "ride" | null; body: ReactNode };

function steps(option: PlanOptionDto, lookups: PlanLookups): Step[] {
  const out: Step[] = [];
  const last = option.legs.length - 1;
  option.legs.forEach((leg, i) => {
    if (leg.kind === "walk" && option.rides > 0 && isNegligibleWalk(leg)) {
      // The point is at the stop itself: no "Walk ≈ 0 m" step. The first such leg becomes a
      // "Start at" step (board here), a transfer one is folded into the next "Board" step, and
      // the last one turns the final step into "Arrive".
      if (i === 0) {
        const name = leg.to.stopId ? lookups.stopName(leg.to.stopId, leg.to.name ?? "the stop") : (leg.to.name ?? "the stop");
        out.push({
          key: `w${i}`,
          marker: "origin",
          rail: "walk",
          body: (
            <>
              <strong className="pn-tl__title">Start at {name}</strong>
              <p className="pn-tl__sub">Board here</p>
            </>
          ),
        });
      } else if (i === last) {
        out.push({ key: `w${i}`, marker: "destination", rail: null, body: <strong className="pn-tl__title">Arrive: your destination is at this stop</strong> });
      }
      return;
    }
    if (leg.kind === "walk") {
      // The final walk carries the destination marker (artboard); a walk-only trip keeps the
      // origin marker and ends with an "Arrive" step.
      const final = i === last && i > 0;
      out.push({
        key: `w${i}`,
        marker: i === 0 ? "origin" : final ? "destination" : "walk",
        rail: final ? null : "walk",
        body: (
          <>
            <strong className="pn-tl__title">{walkTitle(leg, lookups)}</strong>
            <p className="pn-tl__sub">Estimate · path not verified</p>
          </>
        ),
      });
      return;
    }
    out.push(...rideSteps(leg, i, lookups));
  });
  if (last === 0) out.push({ key: "dest", marker: "destination", rail: null, body: <strong className="pn-tl__title">Arrive at your destination</strong> });
  return out;
}

function rideSteps(leg: RideLegDto, i: number, lookups: PlanLookups): Step[] {
  const board = leg.stops[0]!;
  const alight = leg.stops[leg.stops.length - 1]!;
  const boardName = lookups.stopName(board.id, board.name);
  const alightName = lookups.stopName(alight.id, alight.name);
  const route = routeChipLabel(leg.routeCode, leg.routeName);
  const dir = directionText(lookups.direction(leg.variantId), "long");
  const count = leg.stops.length - 1;
  return [
    {
      key: `b${i}`,
      marker: "board",
      rail: "ride",
      body: (
        <div className="pn-tl__stack">
          <div>
            <strong className="pn-tl__title">
              Board {route} at {boardName}
            </strong>
            <p className="pn-tl__sub pn-tl__sub--gold">{CANDIDATE}</p>
            {dir ? <p className="pn-tl__sub">Direction: {dir}</p> : null}
          </div>
          <div className="pn-sign">
            <span className="pn-sign__kicker">Signboard</span>
            <span className="pn-sign__text">Signboard not yet verified</span>
            <LoopChip leg={leg} />
          </div>
          <p className="pn-tl__sub">
            Ride {count} {count === 1 ? "stop" : "stops"} · {formatDistance(leg.distanceMeters)} (straight-line between pins)
          </p>
        </div>
      ),
    },
    {
      key: `a${i}`,
      marker: "alight",
      rail: "walk",
      body: (
        <div className="pn-tl__stack">
          <div>
            <strong className="pn-tl__title">Get off at {alightName}</strong>
            <p className="pn-tl__sub pn-tl__sub--gold">{CANDIDATE}</p>
          </div>
          <div className="pn-para">
            <span className="pn-para__word">Para!</span>
            <span>Say it to the driver as you near this stop.</span>
          </div>
        </div>
      ),
    },
  ];
}

export function TripDetail({ data, option, onBack }: Props) {
  const lookups = planLookups(data);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [option.id]);
  const rides = option.legs.filter((l): l is RideLegDto => l.kind === "ride");

  return (
    <section className="pn-trip pn-trip-detail" aria-labelledby="pn-trip-detail-title" data-testid="trip-detail">
      <div className="pn-trip-detail__bar">
        <button type="button" className="pn-trip-back" aria-label="Back to trip options" onClick={onBack}>
          <svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M10 2L2 10l8 8" />
          </svg>
        </button>
      </div>
      <h2 id="pn-trip-detail-title" ref={headingRef} tabIndex={-1} className="pn-trip-detail__title">
        To your destination
      </h2>
      <p className="pn-trip-detail__labels">{option.labels.join(" · ")}</p>
      <div className="pn-trip-detail__meta">
        <span>Time not available</span>
        <FareChip fare={option.fare} />
      </div>
      {rides.length > 0 ? <UnverifiedBadge /> : null}

      <ol className="pn-tl" aria-label="Trip steps">
        {steps(option, lookups).map((step) => (
          <li key={step.key} className="pn-tl__step">
            <div className="pn-tl__rail">
              <Marker kind={step.marker} />
              {step.rail ? <span className={step.rail === "ride" ? "pn-tl__line pn-tl__line--ride" : "pn-tl__line pn-tl__line--walk"} /> : null}
            </div>
            <div className="pn-tl__body">{step.body}</div>
          </li>
        ))}
      </ol>

      <section className="pn-fares" aria-labelledby="pn-fares-title">
        <h3 id="pn-fares-title">Fare estimate</h3>
        {rides.length === 0 ? (
          <p className="pn-fares__row">
            <span>Walking only</span>
            <span>{fareChipText(option.fare)}</span>
          </p>
        ) : (
          <>
            {rides.map((leg, i) => (
              <p key={i} className="pn-fares__row" data-testid="leg-fare">
                <span>{routeChipLabel(leg.routeCode, leg.routeName)}</span>
                <span>{legFareText(leg.fare)}</span>
              </p>
            ))}
            {rides.length > 1 ? (
              <p className="pn-fares__row pn-fares__row--total">
                <span>Total</span>
                <span>{fareChipText(option.fare)}</span>
              </p>
            ) : null}
            <p className="pn-fares__note">Vehicle class unknown, so each range spans the traditional and modern jeepney minimums. Discounts not applied.</p>
          </>
        )}
      </section>
      <p className="pn-trip-detail__soon">Corrections open soon.</p>
    </section>
  );
}
