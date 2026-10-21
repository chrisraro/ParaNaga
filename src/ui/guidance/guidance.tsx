"use client";

// Guidance inside the home sheet (Task 10): the header (round "End guidance" with a confirmation,
// "Step i of n · Walk|Ride|Transfer", the GPS accuracy "± N m" while location is in use), then the
// current step: Walk, Ride (jeepney), Street ride (tricycle or padyak), Transfer, Arrive, or "Missed your stop?" / "Got off early?"
// (one re-plan screen). Everything shown comes from
// the guidance view (src/domain/guidance/view.ts).
//
// Accessibility: focus moves to the step's heading when the step or screen changes, after a tap on
// a guidance button (the person acted; the tapped button is often gone), or when the focused
// element was removed. GPS alone never moves focus (it would cut the Para alert short). One polite
// live region carries the view's `live` text through the throttle (src/domain/guidance/announce.ts,
// reset whenever focus moves to the heading) and waits while another screen covers the map (the
// home screen is inert then); "Para! Next stop is yours" is the only assertive message, as its own
// role="alert". The accuracy chip shows only a fresh fix (assessFix), styled by its quality.

import "./guidance.css";
import "@/ui/trip/trip.css";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { UseGuidanceSession, GuidanceTap } from "@/client/guidance/use-guidance-session";
import { liveKind, nextPolite, resetAnnouncer, type Announcer } from "@/domain/guidance/announce";
import { assessFix } from "@/domain/geo/location-fix";
import type { GuidanceView, MissedView } from "@/domain/guidance/view";
import { useT } from "@/i18n/provider";
import { SheetBar } from "@/ui/app-shell/sheet-bar";
import { ConfirmDialog } from "@/ui/kit/confirm-dialog";
import { formatAccuracy } from "@/ui/home/location-status";
import { ArriveStep } from "./arrive-step";
import { UndoButton, type LocationUi } from "./guidance-parts";
import { RideStep } from "./ride-step";
import { StreetRideStep } from "./street-ride-step";
import { TransferStep } from "./transfer-step";
import { WalkStep } from "./walk-step";

type Props = {
  guidance: UseGuidanceSession;
  /** Another screen covers the map (home is inert): announcements wait. */
  covered: boolean;
  /** "End guidance" confirmed: the trip goes back to the options. */
  onEnd: () => void;
  /** Arrive → "Done": clears the trip and returns to the map. */
  onDone: () => void;
  /** Missed stop / got off early → plan again from the current fix, or choose the start on the map. */
  onReplan: () => void;
};

type ShownView = Exclude<GuidanceView, { screen: "ended" }>;

const stepKeyOf = (view: ShownView, stepIndex: number) => `${view.screen}:${stepIndex}`;
const actionsKeyOf = (view: ShownView) => view.actions.map((a) => a.event).join(",") + (view.undo ? ",back" : "");

function MissedStep({ view, onSend, onReplan, headingRef }: { view: MissedView; onSend: (e: GuidanceTap) => void; onReplan: () => void; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const g = useT().guidance;
  return (
    <section className="pn-guide__step" aria-labelledby="pn-guide-title" data-testid="guidance-missed">
      <h2 id="pn-guide-title" ref={headingRef} tabIndex={-1} className="pn-guide__title">
        {view.title}
      </h2>
      <p className="pn-guide__body">{view.body}</p>
      <SheetBar className="pn-guide__actions">
        <button type="button" className="pn-btn pn-btn--primary" onClick={onReplan} data-testid="guidance-replan">
          {g.replan}
        </button>
      </SheetBar>
      <UndoButton undo={view.undo} onSend={onSend} />
    </section>
  );
}

function Header({ view, location, now, onEnd }: { view: ShownView; location: UseGuidanceSession["location"]; now: number; onEnd: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const g = useT().guidance;
  const stepLabel = view.screen === "missed" ? null : view.stepLabel;
  // Only a fix that is still fresh is shown; an old one (hidden page, timeouts) is not "± N m" now.
  const assessment = location.watching && location.fix ? assessFix(location.fix, now) : null;
  const accuracy = assessment && !assessment.stale ? location.fix!.accuracy : null;
  return (
    <div className="pn-guide-head" data-testid="guidance-header">
      {view.screen !== "arrive" ? (
        <button type="button" className="pn-guide-head__end" aria-label={g.endGuidance} onClick={() => setConfirming(true)} data-testid="guidance-end">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" focusable="false">
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
      ) : null}
      {stepLabel ? (
        <span className={view.screen === "arrive" ? "pn-guide-head__step pn-guide-head__step--done" : "pn-guide-head__step"} data-testid="guidance-step-label">
          {view.screen === "arrive" ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="M5 12l5 5L20 7" />
            </svg>
          ) : null}
          {stepLabel}
        </span>
      ) : null}
      {accuracy !== null ? (
        <span
          className={assessment?.quality === "precise" ? "pn-guide-head__acc" : "pn-guide-head__acc pn-guide-head__acc--approx"}
          data-testid="guidance-accuracy"
          data-quality={assessment?.quality}
        >
          <span className="sr-only">{`${g.gpsAccuracy} `}</span>
          {formatAccuracy(accuracy)}
        </span>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={g.endConfirmTitle}
        confirmLabel={g.endGuidance}
        cancelLabel={g.keepGoing}
        onConfirm={() => {
          setConfirming(false);
          onEnd();
        }}
        onCancel={() => setConfirming(false)}
        testId="guidance-end-confirm"
      >
        <p>{g.endConfirmBody}</p>
      </ConfirmDialog>
    </div>
  );
}

export function Guidance({ guidance, covered, onEnd, onDone, onReplan }: Props) {
  const { view, session, location, enableLocation, now, card } = guidance;
  const g = useT().guidance;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shown = view && view.screen !== "ended" ? view : null;
  const stepKey = shown && session ? stepKeyOf(shown, session.stepIndex) : "";
  const actionsKey = shown ? actionsKeyOf(shown) : "";
  const polite = shown && shown.live.politeness === "polite" ? shown.live.text : null;

  // A tap on a guidance button: the result is read through the focused heading.
  const [taps, setTaps] = useState(0);
  const send = (event: GuidanceTap) => {
    setTaps((n) => n + 1);
    guidance.send(event);
  };
  const focusKey = `${stepKey}|${taps}`;

  // The polite region: reset (only recorded) whenever focus goes to the heading; later changes go
  // through the throttle, and wait while the map is covered.
  const [seenKey, setSeenKey] = useState(focusKey);
  const [announcer, setAnnouncer] = useState<Announcer>(() => resetAnnouncer(polite, now, g));
  const [liveText, setLiveText] = useState("");
  if (focusKey !== seenKey) {
    setSeenKey(focusKey);
    setAnnouncer(resetAnnouncer(polite, now, g));
  } else if (!covered && polite && shown) {
    const next = nextPolite(announcer, polite, liveKind(shown), now, g);
    if (next.state !== announcer) setAnnouncer(next.state);
    if (next.say) setLiveText(next.say);
  }

  useEffect(() => {
    if (!covered && stepKey) headingRef.current?.focus();
  }, [focusKey, stepKey, covered]);

  // The buttons changed without a tap (GPS): keep focus unless its element is gone.
  useEffect(() => {
    if (covered || !actionsKey) return;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) headingRef.current?.focus();
  }, [actionsKey, covered]);

  if (!shown) return null;
  const locationUi: LocationUi = { state: location.state, watching: location.watching, onEnable: enableLocation };
  const stepProps = { onSend: send, location: locationUi, headingRef };

  return (
    <div className="pn-guide" data-testid="guidance" data-screen={shown.screen}>
      <Header view={shown} location={location} now={now} onEnd={onEnd} />
      {shown.screen === "walk" && shown.stepKind === "transfer" ? (
        <TransferStep view={shown} {...stepProps} />
      ) : shown.screen === "walk" ? (
        <WalkStep view={shown} {...stepProps} />
      ) : shown.screen === "ride" ? (
        <RideStep view={shown} {...stepProps} alertKey={covered ? "covered" : "shown"} />
      ) : shown.screen === "arrive" ? (
        <ArriveStep view={shown} onSend={send} headingRef={headingRef} card={card} onDone={onDone} />
      ) : shown.screen === "missed" ? (
        <MissedStep view={shown} onSend={send} onReplan={onReplan} headingRef={headingRef} />
      ) : shown.screen === "street_ride" ? (
        <StreetRideStep view={shown} {...stepProps} />
      ) : null}
      <p className="sr-only" aria-live="polite" data-testid="guidance-announcer">
        {liveText}
      </p>
    </div>
  );
}
