"use client";

// The "More" tab (artboard Settings) inside PageFrame. Everything here is about this phone:
// preferences live in localStorage (decision D3), nothing is sent anywhere. Rows for things that
// cannot change yet (language, fare category, reduce motion, location access) are plain text with
// a note, never a link or a disabled-looking control (no dead buttons).
//
// Differences from the artboard, on purpose: the Sign in card is a static "Accounts arrive later"
// card (no accounts in this increment); Language is text, not a toggle (English only, D8); Fare
// category has no chevron (no verified discount to choose); Location access is a status read with
// navigator.permissions (no request is made); a "Data on this device" and an "About" group (Help,
// data revision) follow.

import "@/ui/kit/styles";
import "./settings.css";

import { useEffect, useState } from "react";
import { clearDeviceData } from "@/client/device-data";
import { useLocationPermission } from "@/client/geo/use-location-permission";
import { clearHistory, hasHistory } from "@/client/history/trip-history";
import { rememberHead } from "@/client/network/remember-head";
import { useNetworkResource } from "@/client/network/use-network-resource";
import { updatePrefs, usePrefs } from "@/client/prefs/use-prefs";
import { networkHeadSchema, type NetworkHead } from "@/domain/api/schemas";
import { locationAccessLabel } from "@/domain/device/location-permission";
import { publishedDateText } from "@/domain/network/present";
import type { ThemePref } from "@/domain/prefs/prefs";
import { ConfirmDialog } from "@/ui/kit/confirm-dialog";
import { ListCell, ListGroup } from "@/ui/kit/list";
import { Note } from "@/ui/kit/note";
import { Segmented, type SegmentedOption } from "@/ui/kit/segmented";
import { Switch } from "@/ui/kit/switch";

const THEME_OPTIONS: readonly SegmentedOption<ThemePref>[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export const STATUS = {
  cleared: "Data on this phone removed. Settings are back to their defaults.",
  clearFailed: "Some data could not be removed. Try again.",
  historyDeleted: "Trip history on this phone deleted.",
  historyDeleteFailed: "The trip history could not be deleted. Try again.",
} as const;

export const CLEAR_DATA_QUESTION = "Remove saved trips, saved places, trip history and settings from this phone?";
export const DELETE_HISTORY_QUESTION = "Also delete the history on this phone?";

/** "provisional-loops-2026-10-15 · Oct 15, 2026" (published date in Naga City time). */
export function revisionLine(head: NetworkHead): string {
  const date = publishedDateText(head.publishedAt) ?? "publication date not recorded";
  return `${head.label} · ${date}`;
}

function AccountIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

function LocationIcon() {
  return (
    <span className="pn-settings__icon" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" focusable="false">
        <path d="M21 3L3 10.5l7.5 2.9L13.4 21z" />
      </svg>
    </span>
  );
}

/** "Data revision · {label} · {published date}" from GET /api/v1/network/head (More, Help → About data). */
export function DataRevisionRow({ testId = "settings-data-revision" }: { testId?: string }) {
  const head = useNetworkResource("/api/v1/network/head", networkHeadSchema);
  const seen = head.status === "ready" ? head.data : null;
  useEffect(() => {
    if (seen) rememberHead(seen);
  }, [seen]);
  let sub: string;
  if (head.status === "ready") sub = revisionLine(head.data);
  else if (head.status === "loading") sub = "Checking…";
  else if (head.status === "error" && head.offline) sub = "Not available offline";
  else sub = "Not available right now";
  return <ListCell title="Data revision" sub={sub} testId={testId} />;
}

export function MoreScreen() {
  const prefs = usePrefs();
  const permission = useLocationPermission();
  const [confirmClear, setConfirmClear] = useState(false);
  const [askDeleteHistory, setAskDeleteHistory] = useState(false);
  // The status line is a live region: emptied on every change and before each new message, so a
  // repeated message (clearing twice) is announced again and no stale result stays on screen.
  const [status, setStatus] = useState("");
  // Controls animate only once the stored values are showing (see settings.css).
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const change = (patch: Parameters<typeof updatePrefs>[0]) => {
    setStatus("");
    updatePrefs(patch);
  };

  const onHistoryChange = (enabled: boolean) => {
    change({ historyEnabled: enabled });
    if (enabled) return;
    // Recording stops at once; existing history is only deleted if the user says so. If the check
    // fails, nothing is deleted and nothing is asked.
    hasHistory().then(
      (exists) => {
        if (exists) setAskDeleteHistory(true);
      },
      () => undefined,
    );
  };

  const onClear = async () => {
    setConfirmClear(false);
    setStatus("");
    try {
      await clearDeviceData();
      setStatus(STATUS.cleared);
    } catch {
      setStatus(STATUS.clearFailed);
    }
  };

  const onDeleteHistory = async () => {
    setAskDeleteHistory(false);
    setStatus("");
    try {
      await clearHistory();
      setStatus(STATUS.historyDeleted);
    } catch {
      setStatus(STATUS.historyDeleteFailed);
    }
  };

  return (
    <div className="pn-settings" data-ready={ready ? "" : undefined}>
      <div className="pn-card pn-settings__account" data-testid="settings-account">
        <span className="pn-settings__avatar">
          <AccountIcon />
        </span>
        <span className="pn-settings__account-text">
          <strong>Accounts arrive later</strong>
          <span>Everything works without one. Saved trips and places stay on this phone.</span>
        </span>
      </div>

      <div className="pn-settings__group">
        <ListGroup title="General" testId="settings-general">
          <ListCell title="Language" trailing="English" sub="Filipino arrives after a reviewed translation." />
          <ListCell title="Fare category" trailing="Regular" />
          <li className="pn-settings__appearance">
            <span className="pn-settings__row-label" aria-hidden="true">
              Appearance
            </span>
            <Segmented
              label="Appearance"
              options={THEME_OPTIONS}
              value={prefs.theme}
              onChange={(theme) => change({ theme })}
              testId="settings-appearance"
            />
          </li>
        </ListGroup>
        <Note testId="settings-fare-note">
          Discounts for students, seniors and PWD apply only where a verified fare rule allows them. None is verified yet, so ParaNaga shows regular fares.
        </Note>
      </div>

      <ListGroup title="Display and data" testId="settings-display">
        <li>
          <Switch
            label="Low-data mode"
            hint="Hide the map background; pins and trip steps still show"
            checked={prefs.lowData}
            onChange={(lowData) => change({ lowData })}
            testId="settings-low-data"
          />
        </li>
        <li>
          <Switch
            label="High contrast"
            hint="Stronger text and borders"
            checked={prefs.highContrast}
            onChange={(highContrast) => change({ highContrast })}
            testId="settings-high-contrast"
          />
        </li>
        <li>
          <Switch
            label="Trip history"
            hint="Off by default, kept on this device"
            checked={prefs.historyEnabled}
            onChange={onHistoryChange}
            testId="settings-history"
          />
        </li>
        <ListCell title="Reduce motion" trailing="Follows your device setting" />
      </ListGroup>

      <div className="pn-settings__group">
        <ListGroup title="Location" testId="settings-location">
          <ListCell
            icon={<LocationIcon />}
            title="Location access"
            trailing={<span data-testid="settings-location-status">{permission === null ? "Checking…" : locationAccessLabel(permission)}</span>}
          />
        </ListGroup>
        <Note>
          Used only on this device, when you tap “Use current location” or start guidance. Change it in your browser or phone settings.
        </Note>
      </div>

      <section className="pn-section" aria-labelledby="settings-data-title">
        <h2 id="settings-data-title" className="pn-section__title">
          Data on this device
        </h2>
        <button type="button" className="pn-btn pn-btn--danger" onClick={() => setConfirmClear(true)} data-testid="settings-clear-data">
          Clear data on this device
        </button>
        <p className="pn-note-plain" role="status" data-testid="settings-status">
          {status}
        </p>
      </section>

      <ListGroup title="About" testId="settings-about">
        <ListCell title="Help" sub="Safety, how trips are planned, sources" href="/app/help" testId="settings-help" />
        <DataRevisionRow />
      </ListGroup>

      <ConfirmDialog
        open={confirmClear}
        title={CLEAR_DATA_QUESTION}
        confirmLabel="Remove"
        tone="danger"
        onConfirm={() => void onClear()}
        onCancel={() => setConfirmClear(false)}
        testId="settings-clear-dialog"
      />
      <ConfirmDialog
        open={askDeleteHistory}
        title={DELETE_HISTORY_QUESTION}
        confirmLabel="Delete"
        cancelLabel="Keep"
        tone="danger"
        onConfirm={() => void onDeleteHistory()}
        onCancel={() => setAskDeleteHistory(false)}
        testId="settings-history-dialog"
      />
    </div>
  );
}
