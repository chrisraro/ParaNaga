"use client";

// Ride step (artboard Ride). The progress rail counts stops by provisional pin order: with GPS it
// moves on its own (the session's `fix` events); with that count, 3 and 2 stops before the alighting
// stop show a "get ready" line. "I got off" shows only once GPS puts the rider at the alighting stop
// (Para); otherwise "I got off early" re-plans (no manual stop advance).
// The artboard's "On route" pill, "driver signalled" and "beside the … entrance" have no data
// behind them and are not shown. "Para! Next stop is yours" is the one assertive announcement
// (role="alert"). Beyond the card, the phone vibrates and (if the rider allowed notifications from
// a tap) shows a system notification, also with the screen off (src/client/guidance/attention.ts).
// No promise either way. "Report a driver" points to MyNaga (D9).

import Link from "next/link";
import type { RideView } from "@/domain/guidance/view";
import { useAppFrame } from "@/ui/app-shell/app-frame-context";
import { UnverifiedBadge } from "@/ui/trip/trip-parts";
import { GuidanceButtons, KeepOpen, LocationOffer, UndoButton, type StepProps } from "./guidance-parts";

export const REPORT_DRIVER = "Report a driver";
const MYNAGA_PATH = "/app/mynaga";

function Rail({ stops }: { stops: RideView["stops"] }) {
  return (
    <div className="pn-rail" aria-hidden="true" data-testid="ride-rail">
      <span className="pn-rail__track" />
      {stops.map((s, i) => (
        <span key={`${i}-${s.label}`} className={`pn-rail__dot pn-rail__dot--${s.state}`} data-state={s.state} />
      ))}
    </div>
  );
}

export function RideStep({ view, onSend, location, headingRef, alertKey }: StepProps<RideView> & { alertKey: string }) {
  const frame = useAppFrame();
  return (
    <section className="pn-guide__step" aria-labelledby="pn-guide-title" data-testid="guidance-ride">
      <h2 id="pn-guide-title" ref={headingRef} tabIndex={-1} className="pn-guide__title">
        {view.title}
      </h2>
      <p className="pn-guide__sub" data-testid="guidance-ride-route">
        {view.subtitle}
      </p>
      <UnverifiedBadge />
      {view.remainingTime ? (
        <p className="pn-guide__time" data-testid="guidance-ride-time">
          {view.remainingTime}
        </p>
      ) : null}

      <div className="pn-guide__progress" data-testid="ride-progress">
        <p className="pn-guide__count" data-testid="ride-count">
          {view.countText}
        </p>
        <Rail stops={view.stops} />
        {view.alightText ? (
          <p className="pn-guide__rail-labels">
            <span className="pn-guide__rail-alight">{view.alightText}</span>
          </p>
        ) : null}
        <p className="pn-guide__note">{view.countNote}</p>
      </div>

      {view.para && !view.para.acknowledged ? (
        // Remounted when the home screen is uncovered again, so a covered (inert) alert is announced.
        <div key={alertKey} className="pn-guide__para" role="alert" data-testid="para-alert">
          <p className="pn-guide__para-word">{view.para.title}</p>
          <p>{view.para.body}</p>
        </div>
      ) : null}
      {view.para?.acknowledged ? (
        <p className="pn-guide__card pn-guide__card--near" data-testid="para-acknowledged">
          {view.para.body}
        </p>
      ) : null}

      {view.headsUp ? (
        <p className="pn-guide__card pn-guide__card--near" data-testid="ride-heads-up">
          {view.headsUp}
        </p>
      ) : null}

      <LocationOffer location={location} />
      <KeepOpen text={view.keepOpen} />
      <GuidanceButtons actions={view.actions} onSend={onSend} />
      <UndoButton undo={view.undo} onSend={onSend} />
      {/* Marked as opened from the home screen (like a stop pin), so closing MyNaga goes back in
          history to the running guidance instead of pushing a new /app entry. */}
      <Link href={MYNAGA_PATH} className="pn-text-btn pn-guide__report" onClick={() => frame?.markHomeNavigation(MYNAGA_PATH)} data-testid="guidance-report-driver">
        {REPORT_DRIVER}
      </Link>
    </section>
  );
}
