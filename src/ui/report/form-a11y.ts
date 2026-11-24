"use client";

// Shared by the report, sign-in and community forms: one error at a time, tied to its field, and
// focus that never falls to the page body when the control that holds it goes away.

import { createElement, useCallback, useId, useState, type ComponentProps } from "react";
import { flushSync } from "react-dom";

/** Runs a state update; when it removed the focused control, focuses `target` (read after the update). */
export function updateThenFocus(update: () => void, target: () => HTMLElement | null | undefined) {
  flushSync(update);
  const active = document.activeElement;
  if (!active || active === document.body) target()?.focus();
}

/**
 * A status line that is always in the page, so text put into it later is read out (a region that
 * arrives together with its text often is not). Empty, it takes no room (kit.css).
 */
export function Live({ children, className = "", ...rest }: ComponentProps<"p">) {
  return createElement("p", { role: "status", ...rest, className: `pn-live ${className}` }, children || null);
}

const CONTROL = "input, select, textarea";

/**
 * `fail(message, fieldId)` shows the error and moves focus to the field (the first radio of a
 * group); `field(id, hints)` gives that field its id and ARIA; `edited(id)` clears its error.
 * Spread `errorProps` on the visible message: it is the focused field's description, so it is an
 * alert only when no field took focus (else it would be read twice).
 */
export function useFieldError() {
  const errorId = `${useId()}-error`;
  const [error, setError] = useState<{ message: string; field: string | null; alert: boolean } | null>(null);

  const fail = (message: string, field: string | null = null) => {
    const el = field ? document.getElementById(field) : null;
    const control = el?.matches(CONTROL) ? el : el?.querySelector<HTMLElement>(CONTROL);
    // In the DOM before focus moves, so the field is read out with its error.
    flushSync(() => setError({ message, field, alert: !control }));
    control?.focus();
  };
  const clear = useCallback(() => setError(null), []);
  /** Editing a field clears its own error, or one that belongs to no field. */
  const edited = (field: string) => setError((e) => (e && (e.field === null || e.field === field) ? null : e));
  const field = (id: string, hints = "") => {
    const invalid = error?.field === id;
    return {
      id,
      // "false", not left out: some browsers call an empty required field invalid from the start.
      "aria-invalid": invalid,
      "aria-describedby": [hints, invalid ? errorId : ""].filter(Boolean).join(" ") || undefined,
    };
  };
  const errorProps = { id: errorId, role: error?.alert ? ("alert" as const) : undefined };
  return { error: error?.message ?? null, errorId, errorProps, fail, clear, edited, field };
}
