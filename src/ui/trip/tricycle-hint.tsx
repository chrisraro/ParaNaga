"use client";

// "Tricycle may serve this" card (D15, J4), below the trip options: never a ranked option, never a
// minute estimate or a drawn ride line. It appears only from a documented tricycle terminal with a
// coordinate (≤ 600 m) or a published feeder path (≤ 300 m); a waiting area without a coordinate
// never triggers it (src/domain/trip/tricycle-hint.ts). It states the ₱15 minimum fare (Ordinance
// 2024-002), that discounts are not applied, to confirm with the driver, and its sources.
// "Show on map" recentres the map on the terminal.

import "./trip.css";
import "../modes/modes.css";

import { useId } from "react";
import type { TricycleHint } from "@/domain/trip/tricycle-hint";
import { ModeIcon } from "@/ui/modes/mode-icon";

export type TricycleHintSources = {
  /** The tricycle fare rule's sources (F03: Ordinance 2024-002). */
  fare: readonly string[];
  /** The matched feeder route's sources, when a feeder matched. */
  feeder: readonly string[];
};

type Props = {
  hint: TricycleHint;
  sources: TricycleHintSources;
  onShowOnMap?: ((terminal: NonNullable<TricycleHint["terminal"]>) => void) | undefined;
};

export function TricycleHintCard({ hint, sources, onShowOnMap }: Props) {
  const titleId = useId();
  const { copy, terminal } = hint;
  const sourceParts = [
    sources.fare.length > 0 ? `${sources.fare.join(", ")} (fare)` : null,
    terminal ? "OpenStreetMap, community-mapped (terminal location)" : null,
    hint.feeder && sources.feeder.length > 0 ? `${sources.feeder.join(", ")} (feeder route)` : null,
  ].filter((p): p is string => p !== null);

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
      {sourceParts.length > 0 ? (
        <p className="pn-trike-hint__sources" data-testid="tricycle-hint-sources">
          Sources: {sourceParts.join(" · ")}
        </p>
      ) : null}
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
