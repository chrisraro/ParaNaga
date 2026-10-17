// The control that opened a dialog or sheet, so closing it can put focus back there. Safari (and
// Firefox on macOS) do not focus a button on click, so document.activeElement is BODY at open time;
// the last pressed control is the fallback.

let pressed: HTMLElement | null = null;

if (typeof document !== "undefined") {
  document.addEventListener(
    "click",
    (e) => {
      pressed = e.target instanceof Element ? e.target.closest<HTMLElement>("button, a[href], summary, [role='button'], input, [tabindex]") : null;
    },
    true,
  );
}

export function pickOpener(active: Element | null, body: Element | null, last: HTMLElement | null): HTMLElement | null {
  // Safari moves focus on a click to the nearest focusable ancestor of the button (the map region),
  // so a focused element that merely contains the pressed control is not the opener.
  const usable = last?.isConnected ? last : null;
  if (active && active !== body && !(usable && active !== usable && active.contains(usable))) return active as HTMLElement;
  return usable;
}

export function captureOpener(): HTMLElement | null {
  return pickOpener(document.activeElement, document.body, pressed);
}

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal Tab trap that does not depend on the browser's tab order (Safari skips links, so the last
 * focusable element may never receive Tab): every Tab moves focus to the next/previous control in
 * the container, wrapping at the ends, and a Tab from outside lands inside.
 */
export function cycleTab(event: KeyboardEvent, container: HTMLElement | null) {
  if (event.key !== "Tab" || !container) return;
  const list = [...container.querySelectorAll<HTMLElement>(TABBABLE)];
  if (list.length === 0) return;
  event.preventDefault();
  const i = list.indexOf(document.activeElement as HTMLElement);
  const next = event.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i === -1 || i === list.length - 1 ? 0 : i + 1;
  list[next]!.focus();
}
