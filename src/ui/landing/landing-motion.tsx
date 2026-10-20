"use client";

import { useEffect } from "react";

/**
 * The landing page's one behaviour island (renders nothing):
 *  - pauses the looping animations while the tab is hidden (html[data-pnl-hidden]);
 *  - showcase: marks the step in the middle of the viewport and shows its screen (data-on);
 *  - scroll reveals where the browser lacks scroll-driven animations: elements already on screen
 *    are marked before the class goes on, so nothing visible ever blinks out; the rest rise in as
 *    they enter. With reduced motion nothing is hidden at all (landing.css gates every animation).
 */
export function LandingMotion() {
  useEffect(() => {
    const root = document.documentElement;
    const onVisibility = () => root.toggleAttribute("data-pnl-hidden", document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);

    const observers: IntersectionObserver[] = [];

    // Showcase: the step crossing the middle band of the viewport drives the pinned phone.
    const steps = [...document.querySelectorAll<HTMLElement>("[data-pnl-step]")];
    const screens = [...document.querySelectorAll<HTMLElement>("[data-pnl-screen]")];
    const rail = [...document.querySelectorAll<HTMLElement>("[data-pnl-rail]")];
    if (steps.length) {
      const show = (i: string) => {
        for (const el of [...screens, ...rail]) el.dataset.on = String(el.dataset.pnlScreen === i || el.dataset.pnlRail === i);
        for (const el of steps) el.dataset.on = String(el.dataset.pnlStep === i);
      };
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) if (e.isIntersecting) show((e.target as HTMLElement).dataset.pnlStep ?? "0");
        },
        { rootMargin: "-45% 0px -45% 0px" },
      );
      steps.forEach((s) => io.observe(s));
      observers.push(io);
    }

    // One-shot "has entered" marks: the light/dark compare intro, and reveals without native support.
    const motionOk = window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
    const native = typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()");
    const once = [...document.querySelectorAll<HTMLElement>(".pnl-compare__device")];
    if (motionOk && !native) {
      const inView = (el: Element) => {
        const r = el.getBoundingClientRect();
        return r.top < window.innerHeight && r.bottom > 0;
      };
      const pending = [...document.querySelectorAll<HTMLElement>(".pnl-reveal, .pnl-how__line")];
      for (const el of pending) if (inView(el)) el.setAttribute("data-in", "");
      root.classList.add("pnl-io");
      once.push(...pending.filter((el) => !el.hasAttribute("data-in")));
    }
    const io = new IntersectionObserver(
      (entries, obs) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute("data-in", "");
          obs.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    once.forEach((el) => io.observe(el));
    observers.push(io);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      observers.forEach((o) => o.disconnect());
      root.classList.remove("pnl-io");
      root.removeAttribute("data-pnl-hidden");
    };
  }, []);
  return null;
}
