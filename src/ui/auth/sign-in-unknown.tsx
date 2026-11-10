"use client";

import { useT } from "@/i18n/provider";

// The screen's own classes: report.css on the report screens, community.css on the community ones.
const LOOK = {
  report: { box: "pn-report__signin", text: undefined, action: "pn-report__action" },
  community: { box: "pn-comm__panel", text: "pn-comm__body", action: "pn-comm__action" },
} as const;

/**
 * The sign-in check got no answer (offline, server error): offer to check again, never "sign in".
 * While a retry runs (`busy`) the button is off and the status line says so; a retry that fails
 * again puts the message back, so the result is announced.
 */
export function SignInUnknown({
  onRetry,
  busy = false,
  look = "report",
  testId = "signin-unknown",
}: {
  onRetry: () => void;
  busy?: boolean;
  look?: keyof typeof LOOK;
  testId?: string;
}) {
  const tt = useT();
  const c = LOOK[look];
  return (
    <div className={c.box} data-testid={testId}>
      <p className={c.text} role="status">
        {busy ? tt.settings.checking : tt.forms.signInUnknown}
      </p>
      <button type="button" className={`pn-btn pn-btn--secondary ${c.action}`} onClick={onRetry} disabled={busy} aria-busy={busy}>
        {tt.forms.tryAgain}
      </button>
    </div>
  );
}
