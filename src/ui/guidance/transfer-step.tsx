"use client";

// Transfer step (artboard Transfer): "{alight stop} → {board stop}", the ordered checklist (got
// off, walk, wait) and the boarding notes. The artboard's curb, crossing and "[SIGNBOARD TEXT]"
// lines do not exist in the data, so the view says so ("Boarding side isn't mapped…", "Signboard
// text isn't on file…"). Buttons step by step: "I'm at the stop", then "I boarded {route}".

import type { WalkView } from "@/domain/guidance/view";
import { GUIDANCE_COPY } from "@/domain/guidance/view";
import { GuidanceButtons, GuidanceNotes, KeepOpen, LocationOffer, RouteChip, UndoButton, type StepProps } from "./guidance-parts";
import { NextRide, WalkDistance } from "./walk-step";

export function TransferStep({ view, onSend, location, headingRef }: StepProps<WalkView>) {
  const checklist = view.checklist ?? [];
  const current = checklist.findIndex((c) => !c.done);
  return (
    <section className="pn-guide__step" aria-labelledby="pn-guide-title" data-testid="guidance-transfer">
      <h2 id="pn-guide-title" ref={headingRef} tabIndex={-1} className="pn-guide__title">
        {view.title}
      </h2>
      {view.subtitle ? (
        <p className="pn-guide__transfer-line">
          <span>{view.subtitle}</span>
          {view.nextRide ? <RouteChip chip={view.nextRide.chip} /> : null}
        </p>
      ) : null}
      <WalkDistance view={view} />
      <ol className="pn-guide__checklist" aria-label="Transfer steps" data-testid="guidance-checklist">
        {checklist.map((item, i) => (
          <li key={item.text} className={item.done ? "pn-guide__check pn-guide__check--done" : "pn-guide__check"} aria-current={i === current ? "step" : undefined}>
            <span className="pn-guide__check-mark" aria-hidden="true">
              {item.done ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" focusable="false">
                  <path d="M5 12l5 5L20 7" />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <span>
              {item.text}
              {item.done ? <span className="sr-only"> (done)</span> : null}
            </span>
          </li>
        ))}
      </ol>
      <LocationOffer location={location} manual={GUIDANCE_COPY.atStop} />
      <GuidanceNotes notes={view.notes} />
      {view.nextRide ? <NextRide next={view.nextRide} /> : null}
      <KeepOpen text={view.keepOpen} />
      <GuidanceButtons actions={view.actions} onSend={onSend} />
      <UndoButton undo={view.undo} onSend={onSend} />
    </section>
  );
}
