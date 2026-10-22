"use client";
/* eslint-disable @next/next/no-img-element -- pre-encoded WebP captures, see device-frame.tsx. */

import { useState, type CSSProperties } from "react";
import { useT } from "@/i18n/provider";
import { SHOT_H, SHOT_W } from "@/ui/landing/shot-size";

/** The same home screen in light and dark, split by a slider (a native range input). */
export function ThemeCompare() {
  const t = useT().landing.themes;
  const [split, setSplit] = useState(50);
  const img = { width: SHOT_W, height: SHOT_H, loading: "lazy" as const, decoding: "async" as const, className: "pnl-shot" };
  return (
    <>
      <figure className="pnl-device pnl-compare__device" style={{ "--pnl-split": `${split}%` } as CSSProperties}>
        <div className="pnl-device__screen">
          <img {...img} src="/landing/home-light.webp" alt={t.altLight} />
          <img {...img} src="/landing/home-dark.webp" alt={t.altDark} className="pnl-shot pnl-compare__top" style={{ position: "absolute", inset: 0, display: "block" }} />
          <span className="pnl-compare__handle" aria-hidden />
          <span className="pnl-device__camera" aria-hidden />
        </div>
      </figure>
      <label className="pnl-compare__range">
        <span className="pnl-compare__labels" aria-hidden>
          <span>{t.light}</span>
          <span>{t.dark}</span>
        </span>
        <span className="sr-only">{t.compare}</span>
        <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-valuetext={t.darkShown(100 - split)} />
      </label>
    </>
  );
}
