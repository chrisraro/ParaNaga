"use client";

// Exit for content that appears and disappears in place (banners, notices, cards): while `value`
// is null the last value stays rendered, flagged `data-exiting`, until its CSS exit animation ends
// (the element's own animationend). Reduced motion removes it at once. Focus is never involved:
// callers move focus before they clear the value.

import { useState, type AnimationEvent } from "react";
import { useReducedMotion } from "@/client/map/use-reduced-motion";

export function usePresence<T>(value: T | null) {
  const reduced = useReducedMotion();
  const [held, setHeld] = useState(value);
  const [gone, setGone] = useState(value === null);
  if (value !== null && value !== held) setHeld(value);
  if (value !== null && gone) setGone(false);
  const shown = value ?? (gone || reduced ? null : held);
  const exiting = value === null && shown !== null;
  return {
    shown,
    /** Spread on the element: marks it exiting and unmounts it when its exit animation ends. */
    props: {
      "data-exiting": exiting ? "true" : undefined,
      onAnimationEnd: (e: AnimationEvent<HTMLElement>) => {
        if (exiting && e.target === e.currentTarget) setGone(true);
      },
    },
  };
}
