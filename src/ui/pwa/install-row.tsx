"use client";

// More → App: install ParaNaga. Only what the browser really offers: a button when it has fired
// `beforeinstallprompt` (Android / Chromium), the Share → "Add to Home Screen" steps on iPhone and
// iPad, "Installed" inside the installed app, and plain text pointing to the browser menu
// otherwise. No fake prompt, no button that does nothing.

import { useState } from "react";
import { iosInstallText, promptInstall, useInstallState } from "@/client/pwa/install";
import { ListCell, ListGroup } from "@/ui/kit/list";

export const OTHER_INSTALL_TEXT = "To add ParaNaga to your home screen, use your browser’s menu (Install app or Add to Home screen).";

export function InstallRow() {
  const state = useInstallState();
  const [dismissed, setDismissed] = useState(false);

  let cell;
  if (state === "installed") {
    cell = <ListCell title="ParaNaga app" trailing="Installed" testId="settings-install" />;
  } else if (state === "prompt") {
    cell = (
      <ListCell
        title="Install ParaNaga"
        sub="Opens from your home screen, also offline"
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
    cell = <ListCell title="Install ParaNaga" sub={iosInstallText(navigator.userAgent)} testId="settings-install" />;
  } else if (state === "other") {
    cell = (
      <ListCell
        title="Install ParaNaga"
        sub={dismissed ? `Not installed. ${OTHER_INSTALL_TEXT}` : OTHER_INSTALL_TEXT}
        testId="settings-install"
      />
    );
  } else {
    cell = <ListCell title="Install ParaNaga" sub="Checking…" testId="settings-install" />;
  }

  return (
    <ListGroup title="App" testId="settings-app">
      {cell}
    </ListGroup>
  );
}
