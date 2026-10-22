"use client";

// Segmented control (artboard Components "Map mode"; Settings, Saved): a fill track with a thumb
// that slides to the chosen option. Two semantics:
//  - "radiogroup" for a setting (Appearance, Direction): role=radio + aria-checked;
//  - "tablist" for switching a section of the page (Saved trips / places / history): role=tab +
//    aria-selected, optionally aria-controls.
// Keyboard: one tab stop (roving tabindex); arrows move and choose, Home / End jump to the ends.

import "./styles";

import { useRef, type CSSProperties, type KeyboardEvent } from "react";

export type SegmentedOption<V extends string> = { value: V; label: string; /** Language of the label when it differs from the page (screen readers). */ lang?: string; controls?: string; /** Element id of the tab (a tabpanel's aria-labelledby). */ id?: string };

type Props<V extends string> = {
  options: readonly SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Accessible name of the group ("Appearance", "Saved sections"). */
  label: string;
  variant?: "radiogroup" | "tablist";
  testId?: string;
};

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown"]);
const PREV_KEYS = new Set(["ArrowLeft", "ArrowUp"]);

export function Segmented<V extends string>({ options, value, onChange, label, variant = "radiogroup", testId }: Props<V>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const tabs = variant === "tablist";

  const choose = (i: number) => {
    const option = options[i];
    if (!option) return;
    onChange(option.value);
    buttons.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const n = options.length;
    let next: number | null = null;
    if (NEXT_KEYS.has(e.key)) next = (index + 1) % n;
    else if (PREV_KEYS.has(e.key)) next = (index - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    if (next === null) return;
    e.preventDefault();
    choose(next);
  };

  const style = { "--pn-seg-count": options.length, "--pn-seg-index": index } as CSSProperties;
  return (
    // The box is the size container: with large text (200 %) a row too narrow for its labels stacks (kit.css).
    <div className="pn-seg-box">
      <div role={variant} aria-label={label} className="pn-seg pn-seg--kit" style={style} data-count={options.length} data-testid={testId}>
        <span className="pn-seg__thumb" aria-hidden="true" />
        {options.map((o, i) => {
          const on = i === index;
          return (
            <button
              key={o.value}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              id={o.id}
              type="button"
              role={tabs ? "tab" : "radio"}
              aria-checked={tabs ? undefined : on}
              aria-selected={tabs ? on : undefined}
              aria-controls={tabs ? o.controls : undefined}
              tabIndex={on ? 0 : -1}
              lang={o.lang}
              className="pn-seg__btn"
              onClick={() => choose(i)}
              onKeyDown={onKeyDown}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
