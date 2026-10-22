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
import { captureOpener, cycleTab } from "@/ui/kit/opener";
import { ETA_WAITING_NOTE } from "@/ui/help/articles";
import { en } from "@/i18n/dict";
import { useT } from "@/i18n/provider";

export const ETA_BASIS_TITLE = en.eta.basisTitle;
export { ETA_WAITING_NOTE };
/** Said once, here, instead of under every list of options. */
export const ETA_WALK_NOTE = en.eta.walkNote;

type Props = {
  open: boolean;
  onClose: () => void;
  model: EtaModel | null | undefined;
};

export function EtaBasisSheet({ open, onClose, model }: Props) {
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const t = useT();
  const e = t.eta;
  const rows = model ? basisRows(model, e) : [];

  const sheetRef = useRef<HTMLElement>(null);
  // A new onClose each render (the trip detail re-renders every minute) must not re-run the effect.
  const close = useEffectEvent(() => onClose());

  // Modal: focus moves to Close, Tab stays inside the sheet, Escape closes, and focus returns to
  // the control that opened it ("How times are estimated").
  useEffect(() => {
    if (!open) return;
    const opener = captureOpener();
    closeBtnRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      cycleTab(event, sheetRef.current);
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
            {e.basisTitle}
          </h2>
          <button
            ref={closeBtnRef}
            type="button"
            className="pn-layers-sheet__close"
            aria-label={e.basisClose}
            onClick={onClose}
          >
            {e.close}
          </button>
        </header>

        {/* Scrollable on small phones: focusable so it scrolls by keyboard (axe scrollable-region-focusable). */}
        <div className="pn-layers-sheet__body" tabIndex={0} role="region" aria-labelledby={titleId} data-testid="eta-basis-body">
          <p className="pn-eta-sheet__lead" data-testid="eta-basis-lead">
            {t.help.etaWaitingNote} {e.walkNote}
          </p>

          {rows.length === 0 ? (
            <p className="pn-eta-sheet__empty">{e.noModel}</p>
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
