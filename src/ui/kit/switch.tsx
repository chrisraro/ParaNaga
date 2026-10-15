"use client";

// Switch row (artboard Components "Low-data mode", Settings "Display and data"): a label, an
// optional hint, and a 51 x 31 track. role="switch" with aria-checked; the label is a real <label>,
// so tapping the text toggles too. The knob slides unless the user prefers reduced motion (kit.css).

import "./styles";

import { useId } from "react";

type Props = {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId?: string;
};

export function Switch({ label, hint, checked, onChange, testId }: Props) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="pn-switch-row">
      <span className="pn-switch-row__text">
        <label htmlFor={id} className="pn-switch-row__label">
          {label}
        </label>
        {hint ? (
          <span id={hintId} className="pn-switch-row__hint">
            {hint}
          </span>
        ) : null}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={hint ? hintId : undefined}
        className="pn-switch"
        onClick={() => onChange(!checked)}
        data-testid={testId}
      >
        <span className="pn-switch__knob" aria-hidden="true" />
      </button>
    </div>
  );
}
