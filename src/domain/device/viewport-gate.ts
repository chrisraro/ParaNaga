// Phone-only gate for the commuter app (/app).
// ParaNaga is a street companion: it opens on phones and small tablets in portrait
// and shows an "open on your phone" screen on anything wider. The rule is width-only
// so a narrow desktop window or a split-screen tablet still gets the app.

/** Widest viewport, in CSS px, that counts as a phone or small tablet (iPad Air portrait is 820). */
export const PHONE_MAX_WIDTH_PX = 820;

export type ViewportClass = "phone" | "large";

export function classifyViewport(widthPx: number): ViewportClass {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return "large";
  return widthPx <= PHONE_MAX_WIDTH_PX ? "phone" : "large";
}

/** CSS media query that matches exactly the widths classifyViewport calls "phone". */
export const PHONE_MEDIA_QUERY = `(max-width: ${PHONE_MAX_WIDTH_PX}px)`;
