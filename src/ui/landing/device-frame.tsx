/* eslint-disable @next/next/no-img-element -- pre-encoded WebP captures (scripts/capture-landing.ts),
   served as they are: plain <img> with width/height keeps them out of the image optimizer. */
import type { ReactNode } from "react";
import { SCREEN_ALT, SHOT_H, SHOT_W, type Screen } from "@/ui/landing/landing-content";

/**
 * One app capture in both themes. Only the one for the page's theme is displayed (landing.css), and
 * a lazy image that is not displayed is never fetched, so each viewer downloads one of the two.
 */
export function Shot({ screen, eager = false, decorative = false }: { screen: Screen; eager?: boolean; decorative?: boolean }) {
  const alt = decorative ? "" : SCREEN_ALT[screen];
  const common = { width: SHOT_W, height: SHOT_H, decoding: "async" as const, loading: eager ? ("eager" as const) : ("lazy" as const) };
  return (
    <>
      <img {...common} src={`/landing/${screen}-light.webp`} alt={alt} className="pnl-shot pnl-shot--light" fetchPriority={eager ? "high" : undefined} />
      <img {...common} src={`/landing/${screen}-dark.webp`} alt={alt} className="pnl-shot pnl-shot--dark" />
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
