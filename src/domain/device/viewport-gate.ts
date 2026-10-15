// Phone-only gate for the commuter app (/app).
// ParaNaga is a street companion: it opens on phones and small tablets and shows an "open on
// your phone" screen on anything larger. The rule follows the DEVICE, not the current width, so a
// rotated phone keeps the app (landscape is supported, docs/spec/06-screens.md §6.6):
//  - any viewport up to 820 px wide is a phone or small tablet (a narrow desktop window or a
//    split-screen tablet still gets the app), and
//  - a touch device (coarse pointer) whose SHORT side is up to 820 px is one too, whatever its
//    orientation (Pixel 7 landscape is 863 × 412, iPhone Pro Max 932 × 430, iPad Air 1180 × 820).
// A desktop with a mouse wider than 820 px stays gated, even when the window is short.

/** Widest viewport, in CSS px, that counts as a phone or small tablet (iPad Air portrait is 820). */
export const PHONE_MAX_WIDTH_PX = 820;

export type ViewportClass = "phone" | "large";

export type ViewportFacts = {
  widthPx: number;
  heightPx: number;
  /** The primary pointer is coarse (a finger): `(pointer: coarse)`. */
  coarsePointer: boolean;
};

export function classifyViewport({ widthPx, heightPx, coarsePointer }: ViewportFacts): ViewportClass {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return "large";
  if (widthPx <= PHONE_MAX_WIDTH_PX) return "phone";
  if (!coarsePointer || !Number.isFinite(heightPx) || heightPx <= 0) return "large";
  return Math.min(widthPx, heightPx) <= PHONE_MAX_WIDTH_PX ? "phone" : "large";
}

/** CSS media query that matches exactly the viewports classifyViewport calls "phone". */
export const PHONE_MEDIA_QUERY = `(max-width: ${PHONE_MAX_WIDTH_PX}px), (pointer: coarse) and (max-height: ${PHONE_MAX_WIDTH_PX}px)`;
