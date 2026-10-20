"use client";
/* eslint-disable @next/next/no-img-element -- pre-encoded WebP captures, see device-frame.tsx. */

import { useState, type CSSProperties } from "react";
import { SHOT_H, SHOT_W } from "@/ui/landing/landing-content";

/** The same home screen in light and dark, split by a slider (a native range input). */
export function ThemeCompare() {
  const [split, setSplit] = useState(50);
  const img = { width: SHOT_W, height: SHOT_H, loading: "lazy" as const, decoding: "async" as const, className: "pnl-shot" };
  return (
    <>
      <figure className="pnl-device pnl-compare__device" style={{ "--pnl-split": `${split}%` } as CSSProperties}>
        <div className="pnl-device__screen">
          <img {...img} src="/landing/home-light.webp" alt="ParaNaga's home screen in the light theme: the Naga City street map with the Where to? bar and category chips." />
          <img {...img} src="/landing/home-dark.webp" alt="The same home screen in the dark theme: dark search bar, chips and tab bar over the map." className="pnl-shot pnl-compare__top" style={{ position: "absolute", inset: 0, display: "block" }} />
          <span className="pnl-compare__handle" aria-hidden />
          <span className="pnl-device__camera" aria-hidden />
        </div>
      </figure>
      <label className="pnl-compare__range">
        <span className="pnl-compare__labels" aria-hidden>
          <span>Light</span>
          <span>Dark</span>
        </span>
        <span className="sr-only">Compare the light and dark themes</span>
        <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-valuetext={`${100 - split}% dark shown`} />
      </label>
    </>
  );
}
