"use client";

// Walk step (artboard Walk): to the first boarding stop, or from the last stop to the destination.
// The artboard's "[m] to Plaza Rizal stop", boarding side "toward Centro, beside [landmark]" and
// the landmark check are replaced by the view's honest copy: a straight-line distance (GPS) or the
// plan's estimate ("path not verified"), "Boarding side isn't mapped…", and "You look close to …"
// only as a proposal; the person confirms with "I'm at the stop" / "I've arrived".

import { UnverifiedBadge } from "@/ui/trip/trip-parts";
import type { WalkView } from "@/domain/guidance/view";
import { GUIDANCE_COPY } from "@/domain/guidance/view";
import { GuidanceButtons, GuidanceNotes, KeepOpen, LocationOffer, RouteChip, UndoButton, type StepProps } from "./guidance-parts";

/** The view's GPS proposal ("You look close to …"), shown as well as announced. */
export function proposalOf(view: WalkView): string | null {
  return view.live.text.startsWith("You look close to") ? view.live.text : null;
}

export function WalkDistance({ view }: { view: WalkView }) {
  const proposal = proposalOf(view);
  return (
    <>
      {view.distanceText ? (
        <p className="pn-guide__distance" data-testid="guidance-distance">
          {view.distanceText}
        </p>
      ) : null}
      {view.directionText ? <p className="pn-guide__direction">{view.directionText}</p> : null}
      {view.locationNote ? (
        <p className="pn-guide__card pn-guide__card--warn" data-testid="guidance-location-note">
          {view.locationNote}
        </p>
      ) : null}
      {proposal ? (
        <p className="pn-guide__card pn-guide__card--near" data-testid="guidance-proposal">
          {proposal}
        </p>
      ) : null}
    </>
  );
}

export function NextRide({ next }: { next: NonNullable<WalkView["nextRide"]> }) {
  return (
    <div className="pn-guide__next" data-testid="guidance-next-ride">
      <p className="pn-guide__next-row">
        <span>Next:</span>
        <RouteChip chip={next.chip} />
        <span className="pn-guide__route-name">{next.routeName}</span>
      </p>
      {next.direction ? <p className="pn-guide__sub">Direction: {next.direction}</p> : null}
      <UnverifiedBadge />
    </div>
  );
}

export function WalkStep({ view, onSend, location, headingRef }: StepProps<WalkView>) {
  const manual = view.stepKind === "walk_to_destination" ? GUIDANCE_COPY.arrived : GUIDANCE_COPY.atStop;
  return (
    <section className="pn-guide__step" aria-labelledby="pn-guide-title" data-testid="guidance-walk">
      <h2 id="pn-guide-title" ref={headingRef} tabIndex={-1} className="pn-guide__title">
        {view.title}
      </h2>
      <WalkDistance view={view} />
      <LocationOffer location={location} manual={manual} />
      <GuidanceNotes notes={view.notes} />
      {view.nextRide ? <NextRide next={view.nextRide} /> : null}
      <KeepOpen text={view.keepOpen} />
      <GuidanceButtons actions={view.actions} onSend={onSend} />
      <UndoButton undo={view.undo} onSend={onSend} />
    </section>
  );
}
