"use client";

// Bottom guidance strip (home redesign T6): compact bar with End, step label, remaining-time
// estimate from the view model, an optional Steps toggle, and the primary step confirmation button.

import type { GuidanceTap } from "@/client/guidance/use-guidance-session";
import type { GuidanceView } from "@/domain/guidance/view";

type Props = {
  view: GuidanceView | null;
  onEnd: () => void;
  onAction: (event: GuidanceTap) => void;
  onSteps?: (() => void) | undefined;
};

export function GuidanceStrip({ view, onEnd, onAction, onSteps }: Props) {
  if (!view || view.screen === "ended") return null;
  const stepLabel = view.screen === "missed" ? null : view.stepLabel;
  const remaining = "remainingTime" in view ? view.remainingTime : null;
  const primary = view.actions.find((a) => a.kind === "primary") ?? view.actions[0] ?? null;

  return (
    <div className="pn-guide-strip" data-testid="guidance-strip" data-screen={view.screen}>
      <div className="pn-guide-strip__top">
        {view.screen !== "arrive" ? (
          <button
            type="button"
            className="pn-guide-head__end"
            aria-label="End guidance"
            onClick={onEnd}
            data-testid="guidance-strip-end"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        ) : null}
        <div className="pn-guide-strip__meta">
          {stepLabel ? (
            <span className="pn-guide-strip__step" data-testid="guidance-strip-step">
              {stepLabel}
            </span>
          ) : null}
          {remaining ? (
            <span className="pn-guide-strip__time" data-testid="guidance-strip-time">
              {remaining}
            </span>
          ) : null}
        </div>
        {onSteps ? (
          <button
            type="button"
            className="pn-btn pn-btn--secondary pn-guide-strip__steps"
            onClick={onSteps}
            data-testid="guidance-steps-toggle"
          >
            Steps
          </button>
        ) : null}
      </div>
      {primary && primary.event !== "end" ? (
        <button
          type="button"
          className="pn-btn pn-btn--primary pn-guide-strip__primary"
          onClick={() => onAction({ type: primary.event } as GuidanceTap)}
          data-testid="guidance-strip-primary"
        >
          {primary.label}
        </button>
      ) : primary && primary.event === "end" ? (
        <button
          type="button"
          className="pn-btn pn-btn--primary pn-guide-strip__primary"
          onClick={onEnd}
          data-testid="guidance-strip-primary"
        >
          {primary.label}
        </button>
      ) : null}
    </div>
  );
}
