"use client";

import { usePrefsOnDocument } from "@/client/prefs/use-prefs";

/** Keeps <html data-theme / data-contrast> in step with the device preferences (root layout). */
export function DocumentPrefs() {
  usePrefsOnDocument();
  return null;
}
