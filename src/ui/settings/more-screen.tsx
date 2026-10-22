"use client";

// The "More" tab (artboard Settings) inside PageFrame. Everything here is about this phone:
// preferences live in localStorage (decision D3), nothing is sent anywhere. Rows for things that
// cannot change yet (fare category, reduce motion, location access) are plain text with
// a note, never a link or a disabled-looking control (no dead buttons).
//
// Differences from the artboard, on purpose: the Sign in card is a static "Accounts arrive later"
// card (no accounts in this increment); Language is a Segmented choice (ADR 011); Fare
// category has no chevron (no verified discount to choose); Location access is a status read with
// navigator.permissions (no request is made); a "Data on this device" and an "About" group (Help,
// data revision) follow.

import "@/ui/kit/styles";
import "./settings.css";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthSession } from "@/client/auth/use-auth-session";
import { clearDeviceData } from "@/client/device-data";
import { useLocationPermission } from "@/client/geo/use-location-permission";
import { clearHistory, hasHistory } from "@/client/history/trip-history";
import { updatePrefs, usePrefs } from "@/client/prefs/use-prefs";
import { BIKOL_ENABLED, FILIPINO_ENABLED, type Locale } from "@/i18n/locales";
import { en, type Dict } from "@/i18n/dict";
import { setLocale, useT } from "@/i18n/provider";
import { locationAccessLabel } from "@/domain/device/location-permission";
import type { ThemePref } from "@/domain/prefs/prefs";
import { ConfirmDialog } from "@/ui/kit/confirm-dialog";
import { SOURCES_HREF } from "@/ui/help/sources-href";
import { InstallRow } from "@/ui/pwa/install-row";
import { ListCell, ListGroup } from "@/ui/kit/list";
import { Note } from "@/ui/kit/note";
import { Segmented, type SegmentedOption } from "@/ui/kit/segmented";
import { Switch } from "@/ui/kit/switch";
import { PageFrame } from "@/ui/app-shell/page-frame";

const themeOptions = (t: Dict["settings"]): readonly SegmentedOption<ThemePref>[] => [
  { value: "light", label: t.themeLight },
  { value: "dark", label: t.themeDark },
  { value: "system", label: t.themeSystem },
];

// Language names are shown in their own language, so they are not dictionary keys.
type LanguageChoice = Locale | "phone";
const languageOptions = (t: Dict["settings"]): readonly SegmentedOption<LanguageChoice>[] => [
  { value: "phone", label: t.languagePhone },
  { value: "en", label: "English", lang: "en" },
  ...(FILIPINO_ENABLED ? [{ value: "fil", label: "Filipino", lang: "fil" } as const] : []),
  ...(BIKOL_ENABLED ? [{ value: "bcl", label: "Bikol", lang: "bcl" } as const] : []),
];

export const STATUS = {
  cleared: en.settings.cleared,
  clearFailed: en.settings.clearFailed,
  historyDeleted: en.settings.historyDeleted,
  historyDeleteFailed: en.settings.historyDeleteFailed,
} as const;

export const CLEAR_DATA_QUESTION = en.settings.clearQuestion;
export const DELETE_HISTORY_QUESTION = en.settings.deleteHistoryQuestion;

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

/** The More tab page: the frame (large title) around the screen. */
export function MorePage({ driverReports = false }: { driverReports?: boolean }) {
  const t = useT().settings;
  return (
    <PageFrame title={t.title} testId="more-page">
      <MoreScreen driverReports={driverReports} />
    </PageFrame>
  );
}

/** `driverReports`: private reports are live (N2); otherwise "Report a driver" opens MyNaga. */
export function MoreScreen({ driverReports = false }: { driverReports?: boolean }) {
  const t = useT().settings;
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
      setStatus(t.cleared);
    } catch {
      setStatus(t.clearFailed);
    }
  };

  const onDeleteHistory = async () => {
    setAskDeleteHistory(false);
    setStatus("");
    try {
      await clearHistory();
      setStatus(t.historyDeleted);
    } catch {
      setStatus(t.historyDeleteFailed);
    }
  };

  const { user, signOut } = useAuthSession();

  return (
    <div className="pn-settings" data-ready={ready ? "" : undefined}>
      <div className="pn-card pn-settings__account" data-testid="settings-account">
        <div className="pn-settings__account-main">
          <span className="pn-settings__avatar">
            <AccountIcon />
          </span>
          <span className="pn-settings__account-text">
            <strong>{user ? user.name : t.noAccount}</strong>
            <span>{user ? t.signedIn(user.roles.join(", ") || t.roleCommuter) : t.staysOnPhone}</span>
          </span>
        </div>
        {user ? (
          <button
            type="button"
            className="pn-settings__account-action"
            onClick={signOut}
            data-testid="settings-sign-out"
          >
            {t.signOut}
          </button>
        ) : (
          <Link
            href="/app/sign-in"
            className="pn-settings__account-action"
            data-testid="settings-sign-in"
          >
            {t.signIn}
          </Link>
        )}
      </div>

      <div className="pn-settings__group">
        <ListGroup title={t.general} testId="settings-general">
          <li className="pn-settings__appearance">
            <span className="pn-settings__row-label" aria-hidden="true">
              {t.language}
            </span>
            <Segmented
              label={t.language}
              options={languageOptions(t)}
              value={prefs.locale ?? "phone"}
              onChange={(choice) => setLocale(choice === "phone" ? undefined : choice)}
              testId="settings-language"
            />
          </li>
          <ListCell title={t.fareCategory} trailing={t.fareRegular} />
          <li className="pn-settings__appearance">
            <span className="pn-settings__row-label" aria-hidden="true">
              {t.appearance}
            </span>
            <Segmented
              label={t.appearance}
              options={themeOptions(t)}
              value={prefs.theme}
              onChange={(theme) => change({ theme })}
              testId="settings-appearance"
            />
          </li>
        </ListGroup>
        <Note testId="settings-fare-note">
          {t.discountsNote}
        </Note>
      </div>

      <ListGroup title={t.display} testId="settings-display">
        <li>
          <Switch
            label={t.lowData}
            hint={t.lowDataHint}
            checked={prefs.lowData}
            onChange={(lowData) => change({ lowData })}
            testId="settings-low-data"
          />
        </li>
        <li>
          <Switch
            label={t.highContrast}
            hint={t.highContrastHint}
            checked={prefs.highContrast}
            onChange={(highContrast) => change({ highContrast })}
            testId="settings-high-contrast"
          />
        </li>
        <li>
          <Switch
            label={t.history}
            hint={t.historyHint}
            checked={prefs.historyEnabled}
            onChange={onHistoryChange}
            testId="settings-history"
          />
        </li>
        <ListCell title={t.reduceMotion} trailing={t.reduceMotionValue} />
      </ListGroup>

      <div className="pn-settings__group">
        <ListGroup title={t.location} testId="settings-location">
          <ListCell
            icon={<LocationIcon />}
            title={t.locationAccess}
            trailing={<span data-testid="settings-location-status">{permission === null ? t.checking : locationAccessLabel(permission, t)}</span>}
          />
        </ListGroup>
        <Note>
          {t.locationNote}
        </Note>
      </div>

      <section className="pn-section" aria-labelledby="settings-data-title">
        <h2 id="settings-data-title" className="pn-section__title">
          {t.dataTitle}
        </h2>
        <button type="button" className="pn-btn pn-btn--danger" onClick={() => setConfirmClear(true)} data-testid="settings-clear-data">
          {t.clearData}
        </button>
        <p className="pn-note-plain" role="status" data-testid="settings-status">
          {status}
        </p>
      </section>

      <InstallRow />

      <ListGroup title={t.reports} testId="settings-reports">
        <ListCell title={t.myReports} sub={t.myReportsSub} href="/app/reports" testId="settings-my-reports" />
        {driverReports ? (
          <ListCell title={t.reportDriver} sub={t.reportDriverSub} href="/app/report-driver" testId="settings-report-driver" />
        ) : (
          <ListCell title={t.reportDriver} href="/app/mynaga" testId="settings-report-driver" />
        )}
      </ListGroup>

      <ListGroup title={t.about} testId="settings-about">
        <ListCell title={t.help} sub={t.helpSub} href="/app/help" testId="settings-help" />
        <ListCell title={t.sources} href={SOURCES_HREF} testId="settings-sources" />
      </ListGroup>

      <ConfirmDialog
        open={confirmClear}
        title={t.clearQuestion}
        confirmLabel={t.remove}
        tone="danger"
        onConfirm={() => void onClear()}
        onCancel={() => setConfirmClear(false)}
        testId="settings-clear-dialog"
      />
      <ConfirmDialog
        open={askDeleteHistory}
        title={t.deleteHistoryQuestion}
        confirmLabel={t.delete}
        cancelLabel={t.keep}
        tone="danger"
        onConfirm={() => void onDeleteHistory()}
        onCancel={() => setAskDeleteHistory(false)}
        testId="settings-history-dialog"
      />
    </div>
  );
}
