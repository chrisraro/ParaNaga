"use client";

// Trip progress under the guidance header: a progress bar (role="progressbar", with a text value),
// the share done and the distance left, and the arrival time as a range ("≈ 8–12 min · arrive about
// 3:45 PM"). It is not a live region: the bar changes quietly, and the step's own announcements
// stay the only spoken updates. The numbers come from src/domain/guidance/trip-status.ts.

import type { TripStatus } from "@/domain/guidance/trip-status";
import { tripStatusText } from "@/domain/guidance/trip-status-format";
import { useT } from "@/i18n/provider";

export function TripStatusPanel({ status }: { status: TripStatus }) {
  const t = useT();
  const g = t.guidance;
  const text = tripStatusText(status, g, t);
  return (
    <div className="pn-trip-status" role="group" aria-label={g.progressLabel} data-testid="guidance-progress">
      <div className="pn-trip-status__bar" role="progressbar" aria-label={g.progressLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={status.percent} aria-valuetext={text.valueText}>
        <div className="pn-trip-status__fill" style={{ transform: `scaleX(${status.fraction})` }} />
      </div>
      <p className="pn-trip-status__eta" data-testid="guidance-eta">
        {text.etaText}
      </p>
      <p className="pn-trip-status__left" data-testid="guidance-progress-text">
        {text.progressText}
      </p>
      <p className="pn-trip-status__caption" data-testid="guidance-eta-caption">
        {text.caption}
      </p>
    </div>
  );
}
