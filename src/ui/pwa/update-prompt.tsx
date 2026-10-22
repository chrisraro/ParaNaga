"use client";

// "A new version of ParaNaga is ready. [Reload]" (Task 12). Shown only when a new service worker
// is installed and waiting behind the one controlling this page; never while guidance runs (a
// reload must not interrupt a trip in progress, so the card hides and Reload re-checks). Nothing
// reloads until the person taps Reload. "Later" hides the card for this page session; More → App
// keeps "Update ready — Reload" while the version waits.

import "./pwa.css";

import { useEffect, useSyncExternalStore } from "react";
import { getGuidanceServerSnapshot, getGuidanceSnapshot, subscribeGuidance } from "@/client/guidance/guidance-store";
import { applyUpdate, checkForUpdate, postponeUpdate, useUpdateCard } from "@/client/pwa/register-sw";
import { useAppFrame } from "@/ui/app-shell/app-frame-context";
import { en } from "@/i18n/dict";
import { useT } from "@/i18n/provider";
import { usePresence } from "@/ui/app-shell/presence";

export const UPDATE_TEXT = en.pwa.updateText;

export function UpdatePrompt() {
  const t = useT().pwa;
  const ready = useUpdateCard();
  const guiding = useSyncExternalStore(subscribeGuidance, getGuidanceSnapshot, getGuidanceServerSnapshot) !== null;

  // Coming back to the app is a good moment to look for a new version.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const { shown: show, props: presence } = usePresence(ready && !guiding ? true : null);
  // Above the tab bar when it shows (its measured height, safe area included).
  const clearance = useAppFrame()?.tabBarClearance ?? 0;
  return (
    <div className="pn-pwa" role="status" data-testid="update-status">
      {show ? (
        <div className="pn-update" data-testid="update-prompt" style={clearance > 0 ? { bottom: clearance + 12 } : undefined} {...presence}>
          <p>{t.updateText}</p>
          <button
            type="button"
            onClick={() => {
              if (getGuidanceSnapshot() === null) applyUpdate();
            }}
          >
            {t.reload}
          </button>
          <button type="button" className="pn-update__later" onClick={postponeUpdate}>
            {t.later}
          </button>
        </div>
      ) : null}
    </div>
  );
}
