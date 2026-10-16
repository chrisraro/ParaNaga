"use client";

// Exit for content that appears and disappears in place (banners, notices, cards): while `value`
// is null the last value stays rendered, flagged `data-exiting`, until its CSS exit animation ends
// (the element's own animationend). Reduced motion removes it at once. While it exits it is inert
// and hidden from assistive technology, and if focus was inside when `value` cleared, focus moves
// to `fallback()` first, so a control that removes its own container never drops focus to <body>.

import { useEffectEvent, useLayoutEffect, useRef, useState, type AnimationEvent, type FocusEvent } from "react";
import { useReducedMotion } from "@/client/map/use-reduced-motion";

/** The page's main heading (made focusable on demand): the fallback when nothing closer fits. */
export function focusMainHeading(): HTMLElement | null {
  const h = document.querySelector<HTMLElement>("main h1");
  if (h && !h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1");
  return h;
}

export function usePresence<T>(value: T | null, fallback: () => HTMLElement | null = focusMainHeading) {
  const reduced = useReducedMotion();
  const [held, setHeld] = useState(value);
  const [gone, setGone] = useState(value === null);
  if (value !== null && value !== held) setHeld(value);
  if (value !== null && gone) setGone(false);
  const shown = value ?? (gone || reduced ? null : held);
  const exiting = value === null && shown !== null;
  // Focus inside the node, tracked by events: when reduced motion unmounts it in the same commit,
  // the browser has already dropped focus by the time an effect could look at activeElement.
  const focusInside = useRef(false);
  const cleared = value === null;
  const moveFocus = useEffectEvent(() => {
    if (!focusInside.current) return;
    focusInside.current = false;
    fallback()?.focus({ preventScroll: true });
  });
  useLayoutEffect(() => {
    if (cleared) moveFocus();
  }, [cleared]);
  return {
    shown,
    /** Spread on the element: marks it exiting and unmounts it when its exit animation ends. */
    props: {
      "data-exiting": exiting ? "true" : undefined,
      inert: exiting ? true : undefined,
      "aria-hidden": exiting ? true : undefined,
      onFocus: () => {
        focusInside.current = true;
      },
      onBlur: (e: FocusEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget)) focusInside.current = false;
      },
      onAnimationEnd: (e: AnimationEvent<HTMLElement>) => {
        if (exiting && e.target === e.currentTarget) setGone(true);
      },
    },
  };
}
