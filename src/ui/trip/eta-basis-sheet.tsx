"use client";

// "How times are estimated" sheet (Task 14, D8–D12, WCAG 2.2 AA).
// Opened from the "How times are estimated" button in trip detail.
// Lists the six basis rows from `basisRows(model)`, citing sources (N04, N16, N28, N29)
// and assumptions (A1–A3), plus the copy:
// "Times are ranges. They do not include waiting, because Naga has no published jeepney schedules."

import "./trip.css";

import { useEffect, useEffectEvent, useId, useRef } from "react";
import type { EtaModel } from "@/domain/api/schemas";
import { basisRows } from "@/domain/eta/basis";
import { ETA_WAITING_NOTE } from "@/ui/help/articles";

export const ETA_BASIS_TITLE = "How times are estimated" as const;
export { ETA_WAITING_NOTE };
/** Said once, here, instead of under every list of options. */
export const ETA_WALK_NOTE = "Walking distances are estimates; paths not verified.";

type Props = {
  open: boolean;
  onClose: () => void;
  model: EtaModel | null | undefined;
};

export function EtaBasisSheet({ open, onClose, model }: Props) {
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const rows = model ? basisRows(model) : [];

  const sheetRef = useRef<HTMLElement>(null);
  // A new onClose each render (the trip detail re-renders every minute) must not re-run the effect.
  const close = useEffectEvent(() => onClose());

  // Modal: focus moves to Close, Tab stays inside the sheet, Escape closes, and focus returns to
  // the control that opened it ("How times are estimated").
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeBtnRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = [...sheetRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      const inside = sheetRef.current.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="pn-layers-backdrop" data-testid="eta-basis-backdrop" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={sheetRef}
        className="pn-layers-sheet pn-eta-sheet"
        data-testid="eta-basis-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pn-layers-sheet__head">
          <h2 id={titleId} className="pn-layers-sheet__title">
            {ETA_BASIS_TITLE}
          </h2>
          <button
            ref={closeBtnRef}
            type="button"
            className="pn-layers-sheet__close"
            aria-label="Close how times are estimated"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        {/* Scrollable on small phones: focusable so it scrolls by keyboard (axe scrollable-region-focusable). */}
        <div className="pn-layers-sheet__body" tabIndex={0} role="region" aria-labelledby={titleId} data-testid="eta-basis-body">
          <p className="pn-eta-sheet__lead" data-testid="eta-basis-lead">
            {ETA_WAITING_NOTE} {ETA_WALK_NOTE}
          </p>

          {rows.length === 0 ? (
            <p className="pn-eta-sheet__empty">Time-estimate model not on file for this revision.</p>
          ) : (
            <ul className="pn-eta-sheet__list" data-testid="eta-basis-list">
              {rows.map((row) => (
                <li key={row.key} className="pn-eta-sheet__item" data-basis-row={row.key}>
                  <p className="pn-eta-sheet__text">{row.text}</p>
                  {row.assumptions.length > 0 ? (
                    <ul className="pn-eta-sheet__assumptions">
                      {row.assumptions.map((note, idx) => (
                        <li key={idx} className="pn-eta-sheet__assumption">
                          {note}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
