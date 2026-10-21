"use client";

// Loading, error (offline / server) and no-coverage states of the trip results in the sheet.

import "./trip.css";

import type { PlanErrorKind } from "@/client/trip/use-trip-plan";
import type { PlanResponse } from "@/domain/api/plan";
import type { Dict } from "@/i18n/dict";
import { noCoverageCopy } from "@/domain/trip/present";
import { useT } from "@/i18n/provider";

export function TripLoading() {
  const t = useT().trip;
  return (
    // Announced through the home announcer (a live region that is always mounted).
    <section className="pn-trip-state" aria-busy="true" data-testid="trip-loading">
      <svg className="pn-trip-state__spinner" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="42 60" strokeLinecap="round" />
      </svg>
      <p>{t.finding}</p>
    </section>
  );
}

const errorCopy = (t: Dict["trip"]): Record<PlanErrorKind, { title: string; detail: string }> => ({
  offline: { title: t.offline, detail: t.offlineDetail },
  server: { title: t.serverError, detail: t.serverDetail },
  invalid: { title: t.invalid, detail: t.invalidDetail },
  busy: { title: t.busy, detail: t.busyDetail },
});

type ErrorProps = { kind: PlanErrorKind; onRetry: () => void; onChangeEndpoints: () => void };

export function TripError({ kind, onRetry, onChangeEndpoints }: ErrorProps) {
  const t = useT().trip;
  const copy = errorCopy(t)[kind];
  // A rejected request (400) fails the same way again: offer to change the points instead.
  const invalid = kind === "invalid";
  return (
    <section className="pn-trip-state pn-trip-state--error" role="alert" data-testid="trip-error">
      <div>
        <h2 className="pn-trip-state__title" tabIndex={-1} data-results-heading="">
          {copy.title}
        </h2>
        <p>{copy.detail}</p>
        <button type="button" className="pn-trip-retry" onClick={invalid ? onChangeEndpoints : onRetry}>
          {invalid ? t.changeEnds : t.tryAgain}
        </button>
      </div>
    </section>
  );
}

export function TripNoCoverage({ data }: { data: PlanResponse }) {
  const t = useT();
  const copy = noCoverageCopy(data.plan.reason, data.plan.directWalkEstimateMeters, t.trip, t.geo);
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
        <h2 id="pn-no-route-title" tabIndex={-1} data-results-heading="">
          {copy.title}
        </h2>
        <p>{copy.detail}</p>
      </div>
    </section>
  );
}
