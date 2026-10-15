"use client";

// Guidance inside the home sheet (Task 10): the header (round "End guidance" with a confirmation,
// "Step i of n · Walk|Ride|Transfer", the GPS accuracy "± N m" while location is in use), then the
// current step: Walk, Ride, Transfer, Arrive, or "Missed your stop?". Everything shown comes from
// the guidance view (src/domain/guidance/view.ts).
//
// Accessibility: focus moves to the step's heading whenever the step or its buttons change (the
// tapped button is usually gone). One polite live region carries the view's `live` text, throttled
// for the walking distance (src/domain/guidance/announce.ts) and held while another screen covers
// the map (the home screen is inert then); "Para! Next stop is yours" is the only assertive
// message, as its own role="alert".

import "./guidance.css";
import "@/ui/trip/trip.css";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { UseGuidanceSession, GuidanceTap } from "@/client/guidance/use-guidance-session";
import { nextPoliteAnnouncement, type Announcement } from "@/domain/guidance/announce";
import type { GuidanceView, MissedView } from "@/domain/guidance/view";
import { ConfirmDialog } from "@/ui/kit/confirm-dialog";
import { formatAccuracy } from "@/ui/home/location-status";
import { ArriveStep } from "./arrive-step";
import { UndoButton, type LocationUi } from "./guidance-parts";
import { RideStep } from "./ride-step";
import { TransferStep } from "./transfer-step";
import { WalkStep } from "./walk-step";

export const END_CONFIRM_TITLE = "End guidance?";
export const END_CONFIRM_BODY = "Your trip stays in the options.";
export const REPLAN = "Plan again from where you are";

type Props = {
  guidance: UseGuidanceSession;
  /** Another screen covers the map (home is inert): announcements wait. */
  covered: boolean;
  /** "End guidance" confirmed: the trip goes back to the options. */
  onEnd: () => void;
  /** Arrive → "Done": clears the trip and returns to the map. */
  onDone: () => void;
  /** Missed stop → plan again from the current fix, or choose the start on the map. */
  onReplan: () => void;
};

type ShownView = Exclude<GuidanceView, { screen: "ended" }>;

function focusKey(view: ShownView, stepIndex: number): string {
  return `${view.screen}:${stepIndex}:${view.actions.map((a) => a.event).join(",")}`;
}

function MissedStep({ view, onSend, onReplan, headingRef }: { view: MissedView; onSend: (e: GuidanceTap) => void; onReplan: () => void; headingRef: RefObject<HTMLHeadingElement | null> }) {
  return (
    <section className="pn-guide__step" aria-labelledby="pn-guide-title" data-testid="guidance-missed">
      <h2 id="pn-guide-title" ref={headingRef} tabIndex={-1} className="pn-guide__title">
        {view.title}
      </h2>
      <p className="pn-guide__body">{view.body}</p>
      <div className="pn-guide__actions">
        <button type="button" className="pn-btn pn-btn--primary" onClick={onReplan} data-testid="guidance-replan">
          {REPLAN}
        </button>
      </div>
      <UndoButton undo={view.undo} onSend={onSend} />
    </section>
  );
}

function Header({ view, location, onEnd }: { view: ShownView; location: UseGuidanceSession["location"]; onEnd: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const stepLabel = view.screen === "missed" ? null : view.stepLabel;
  const accuracy = location.watching && location.fix ? location.fix.accuracy : null;
  return (
    <div className="pn-guide-head" data-testid="guidance-header">
      {view.screen !== "arrive" ? (
        <button type="button" className="pn-guide-head__end" aria-label="End guidance" onClick={() => setConfirming(true)} data-testid="guidance-end">
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
        <span className={accuracy <= 30 ? "pn-guide-head__acc" : "pn-guide-head__acc pn-guide-head__acc--approx"} data-testid="guidance-accuracy">
          <span className="sr-only">GPS accuracy </span>
          {formatAccuracy(accuracy)}
        </span>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={END_CONFIRM_TITLE}
        confirmLabel="End guidance"
        cancelLabel="Keep going"
        onConfirm={() => {
          setConfirming(false);
          onEnd();
        }}
        onCancel={() => setConfirming(false)}
        testId="guidance-end-confirm"
      >
        <p>{END_CONFIRM_BODY}</p>
      </ConfirmDialog>
    </div>
  );
}

export function Guidance({ guidance, covered, onEnd, onDone, onReplan }: Props) {
  const { view, session, location, send, enableLocation, now, card } = guidance;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shown = view && view.screen !== "ended" ? view : null;
  const key = shown && session ? focusKey(shown, session.stepIndex) : "";
  const polite = shown && shown.live.politeness === "polite" ? shown.live.text : null;

  // The polite region: the first text of each step is read through the focused heading, so it is
  // only recorded; later changes go through the throttle, and wait while the map is covered.
  const [seenKey, setSeenKey] = useState(key);
  const [announced, setAnnounced] = useState<Announcement | null>(() => (polite ? { text: polite, at: now } : null));
  const [liveText, setLiveText] = useState("");
  if (key !== seenKey) {
    setSeenKey(key);
    setAnnounced(polite ? { text: polite, at: now } : null);
  } else if (!covered && polite) {
    const next = nextPoliteAnnouncement(announced, polite, now);
    if (next) {
      setAnnounced(next);
      setLiveText(next.text);
    }
  }

  useEffect(() => {
    if (!covered && key) headingRef.current?.focus();
  }, [key, covered]);

  if (!shown) return null;
  const locationUi: LocationUi = { state: location.state, watching: location.watching, onEnable: enableLocation };
  const stepProps = { onSend: send, location: locationUi, headingRef };

  return (
    <div className="pn-guide" data-testid="guidance" data-screen={shown.screen}>
      <Header view={shown} location={location} onEnd={onEnd} />
      {shown.screen === "walk" && shown.stepKind === "transfer" ? (
        <TransferStep view={shown} {...stepProps} />
      ) : shown.screen === "walk" ? (
        <WalkStep view={shown} {...stepProps} />
      ) : shown.screen === "ride" ? (
        <RideStep view={shown} {...stepProps} alertKey={covered ? "covered" : "shown"} />
      ) : shown.screen === "arrive" ? (
        <ArriveStep view={shown} onSend={send} headingRef={headingRef} card={card} onDone={onDone} />
      ) : (
        <MissedStep view={shown} onSend={send} onReplan={onReplan} headingRef={headingRef} />
      )}
      <p className="sr-only" aria-live="polite" data-testid="guidance-announcer">
        {liveText}
      </p>
    </div>
  );
}
