"use client";

// Loading, error (offline / server) and no-coverage states of the trip results in the sheet.

import "./trip.css";

import type { PlanErrorKind } from "@/client/trip/use-trip-plan";
import type { PlanResponse } from "@/domain/api/plan";
import { noCoverageCopy } from "@/domain/trip/present";

export function TripLoading() {
  return (
    <section className="pn-trip-state" aria-busy="true" data-testid="trip-loading">
      <svg className="pn-trip-state__spinner" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="42 60" strokeLinecap="round" />
      </svg>
      <p role="status">Looking for provisional routes…</p>
    </section>
  );
}

const ERROR_COPY: Record<PlanErrorKind, { title: string; detail: string }> = {
  offline: { title: "You're offline", detail: "Connect to the internet to see provisional routes." },
  server: { title: "Couldn't load trip options", detail: "Something went wrong on our side or with the connection. Try again." },
  invalid: { title: "Couldn't plan this trip", detail: "Check that both points are inside Naga City, then try again." },
};

export function TripError({ kind, onRetry }: { kind: PlanErrorKind; onRetry: () => void }) {
  const copy = ERROR_COPY[kind];
  return (
    <section className="pn-trip-state pn-trip-state--error" role="alert" data-testid="trip-error">
      <div>
        <h2 className="pn-trip-state__title">{copy.title}</h2>
        <p>{copy.detail}</p>
        <button type="button" className="pn-trip-retry" onClick={onRetry}>
          Try again
        </button>
      </div>
    </section>
  );
}

export function TripNoCoverage({ data }: { data: PlanResponse }) {
  const copy = noCoverageCopy(data.plan.reason, data.plan.directWalkEstimateMeters);
  return (
    <section className="pn-honest" aria-labelledby="pn-no-route-title" data-testid="no-provisional-route">
      <span className="pn-honest__icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" focusable="false">
          <circle cx="6" cy="18" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="18" cy="6" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M8 16.5L16 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 3.2" />
        </svg>
      </span>
      <div>
        <h2 id="pn-no-route-title">{copy.title}</h2>
        <p>{copy.detail}</p>
        <p className="pn-trip__revision pn-trip__revision--left">Transport data revision {data.revision.label}</p>
      </div>
    </section>
  );
}
