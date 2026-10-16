"use client";

// Street ride step (tricycle or padyak to the destination). One step: the instruction ("Take a
// tricycle to … · about 1.5 km along streets · minimum fare ₱15 · confirm with the driver"), the
// planner's notes (rules applied, fare, "time not estimated"), and "I've arrived". No stop count and
// no GPS progress: this ride has no stops and no time (view.remainingTime says so, never minutes).

import type { StreetRideView } from "@/domain/guidance/view";
import { GuidanceButtons, GuidanceNotes, KeepOpen, UndoButton, type StepProps } from "./guidance-parts";

export function StreetRideStep({ view, onSend, headingRef }: StepProps<StreetRideView>) {
  return (
    <section className="pn-guide__step" aria-labelledby="pn-guide-title" data-testid="guidance-street-ride" data-mode={view.mode}>
      <h2 id="pn-guide-title" ref={headingRef} tabIndex={-1} className="pn-guide__title">
        {view.title}
      </h2>
      <p className="pn-guide__sub" data-testid="guidance-street-instruction">
        {view.instruction}
      </p>
      <p className="pn-guide__time" data-testid="guidance-street-time">
        {view.remainingTime}
      </p>
      <GuidanceNotes notes={view.notes} />
      <KeepOpen text={view.keepOpen} />
      <GuidanceButtons actions={view.actions} onSend={onSend} />
      <UndoButton undo={view.undo} onSend={onSend} />
    </section>
  );
}
