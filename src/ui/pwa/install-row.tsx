"use client";

// More → App: install ParaNaga. Only what the browser really offers: a button when it has fired
// `beforeinstallprompt` (Android / Chromium), the Share → "Add to Home Screen" steps on iPhone and
// iPad, "Installed" inside the installed app, and plain text pointing to the browser menu
// otherwise. No fake prompt, no button that does nothing. While a new version waits, the group also
// offers "Update ready — Reload" (the card's Reload, still there after "Later").

import { useState } from "react";
import { getGuidanceSnapshot } from "@/client/guidance/guidance-store";
import { iosInstallText, promptInstall, useInstallState } from "@/client/pwa/install";
import { applyUpdate, useUpdateReady } from "@/client/pwa/register-sw";
import { en } from "@/i18n/dict";
import { useT } from "@/i18n/provider";
import { ListCell, ListGroup } from "@/ui/kit/list";

export const OTHER_INSTALL_TEXT = en.pwa.installOther;

export function InstallRow() {
  const t = useT().pwa;
  const state = useInstallState();
  const updateReady = useUpdateReady();
  const [dismissed, setDismissed] = useState(false);

  let cell;
  if (state === "installed") {
    cell = <ListCell title={t.installAppRow} trailing={t.installed} testId="settings-install" />;
  } else if (state === "prompt") {
    cell = (
      <ListCell
        title={t.installTitle}
        sub={t.installSub}
        onClick={() => {
          setDismissed(false);
          promptInstall().then(
            (outcome) => setDismissed(outcome === "dismissed"),
            () => undefined,
          );
        }}
        testId="settings-install"
      />
    );
  } else if (state === "ios") {
    cell = <ListCell title={t.installTitle} sub={iosInstallText(navigator.userAgent, t)} testId="settings-install" />;
  } else if (state === "other") {
    cell = (
      <ListCell
        title={t.installTitle}
        sub={dismissed ? t.installDismissed(t.installOther) : t.installOther}
        testId="settings-install"
      />
    );
  } else {
    cell = <ListCell title={t.installTitle} sub={t.installChecking} testId="settings-install" />;
  }

  return (
    <ListGroup title={t.installGroup} testId="settings-app">
      {cell}
      {updateReady ? (
        <ListCell
          title={t.updateReadyTitle}
          sub={t.updateReadySub}
          onClick={() => {
            if (getGuidanceSnapshot() === null) applyUpdate();
          }}
          testId="settings-update"
        />
      ) : null}
    </ListGroup>
  );
}
