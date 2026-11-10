"use client";

/* eslint-disable @next/next/no-img-element -- pre-encoded WebP captures (tests/e2e/landing-captures.spec.ts),
   served as they are: plain <img> with width/height keeps them out of the image optimizer. */
import type { ReactNode } from "react";
import { useT } from "@/i18n/provider";
import { SHOT_H, SHOT_W, type Screen } from "@/ui/landing/landing-content";

/** The directions step shows the hero's capture: the same screen, one file. */
const FILE: Partial<Record<Screen, Screen>> = { directions: "hero" };

/**
 * One app capture in both themes. Only the one for the page's theme is displayed (landing.css), and
 * a lazy image that is not displayed is never fetched, so each viewer downloads one of the two. An
 * eager capture keeps its dark copy lazy for the same reason (it still loads at once when shown).
 */
export function Shot({ screen, eager = false, decorative = false }: { screen: Screen; eager?: boolean; decorative?: boolean }) {
  const alt = useT().landing.alt;
  const text = decorative ? "" : alt[screen];
  const file = FILE[screen] ?? screen;
  const common = { width: SHOT_W, height: SHOT_H, decoding: "async" as const };
  return (
    <>
      <img {...common} loading={eager ? "eager" : "lazy"} src={`/landing/${file}-light.webp`} alt={text} className="pnl-shot pnl-shot--light" fetchPriority={eager ? "high" : undefined} />
      <img {...common} loading="lazy" src={`/landing/${file}-dark.webp`} alt={text} className="pnl-shot pnl-shot--dark" />
    </>
  );
}

/** A plain phone: bezel, rounded screen and a punch-hole camera. No maker's marks. */
export function DeviceFrame({ children, className = "", label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <figure className={`pnl-device ${className}`} aria-label={label}>
      <div className="pnl-device__screen">
        {children}
        <span className="pnl-device__camera" aria-hidden />
      </div>
    </figure>
  );
}
