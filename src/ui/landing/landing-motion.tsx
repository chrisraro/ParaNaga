"use client";

import { useEffect } from "react";

/**
 * The landing page's one motion island (renders nothing): the captures rise in as they enter the
 * viewport. Text is never part of it, so no words are ever part-way faded. Everything is visible
 * by default: only once this has run, and only where motion is welcome, are the captures still
 * below the fold held back (html.pnl-io, then data-in as each one enters). Captures already on
 * screen are marked first, so nothing visible blinks out. landing.css holds the transition.
 */
export function LandingMotion() {
  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    const root = document.documentElement;
    const targets = [...document.querySelectorAll<HTMLElement>(".pnl-reveal")];
    const pending = targets.filter((el) => {
      const r = el.getBoundingClientRect();
      const seen = r.top < window.innerHeight && r.bottom > 0;
      if (seen) el.setAttribute("data-in", "");
      return !seen;
    });
    root.classList.add("pnl-io");
    const io = new IntersectionObserver(
      (entries, obs) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute("data-in", "");
          obs.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    pending.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      root.classList.remove("pnl-io");
    };
  }, []);
  return null;
}
