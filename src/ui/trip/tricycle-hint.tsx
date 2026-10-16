"use client";

// "Tricycle may serve this" card (D15, J4), below the trip options: never a ranked option, never a
// minute estimate or a drawn ride line. It appears only from a documented tricycle terminal with a
// coordinate (≤ 600 m) or a published feeder path (≤ 300 m); a waiting area without a coordinate
// never triggers it (src/domain/trip/tricycle-hint.ts). It states the ₱15 minimum fare, that
// discounts are not applied and to confirm with the driver; its sources are on Sources and credits.
// "Show on map" recentres the map on the terminal.

import "./trip.css";
import "../modes/modes.css";

import { useId } from "react";
import type { TricycleHint } from "@/domain/trip/tricycle-hint";
import { ModeIcon } from "@/ui/modes/mode-icon";

type Props = {
  hint: TricycleHint;
  onShowOnMap?: ((terminal: NonNullable<TricycleHint["terminal"]>) => void) | undefined;
};

export function TricycleHintCard({ hint, onShowOnMap }: Props) {
  const titleId = useId();
  const { copy, terminal } = hint;

  return (
    <section className="pn-trike-hint" aria-labelledby={titleId} data-testid="tricycle-hint">
      <h3 id={titleId} className="pn-trike-hint__title">
        <span className="pn-trike-hint__icon">
          <ModeIcon mode="tricycle" size={18} />
        </span>
        {copy.title}
      </h3>
      {copy.terminalText ? (
        <p className="pn-trike-hint__match" data-testid="tricycle-hint-terminal">
          {copy.terminalText}
        </p>
      ) : null}
      {copy.feederText ? (
        <p className="pn-trike-hint__match" data-testid="tricycle-hint-feeder">
          {copy.feederText}
        </p>
      ) : null}
      <p data-testid="tricycle-hint-fare">{copy.fareNote}</p>
      <p>{copy.zonesNote}</p>
      <p data-testid="tricycle-hint-time">{copy.timeNote}</p>
      {terminal && onShowOnMap ? (
        <button
          type="button"
          className="pn-btn pn-btn--secondary pn-trike-hint__btn"
          onClick={() => onShowOnMap(terminal)}
          aria-label={`Show on map: ${terminal.name}`}
          data-testid="tricycle-hint-show"
        >
          Show on map
        </button>
      ) : null}
    </section>
  );
}
