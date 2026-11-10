"use client";

import { useT } from "@/i18n/provider";

/** The sign-in check got no answer (offline, server error): offer to check again, never "sign in". */
export function SignInUnknown({ onRetry }: { onRetry: () => void }) {
  const t = useT().forms;
  return (
    <div className="pn-report__signin" data-testid="signin-unknown">
      <p role="status">{t.signInUnknown}</p>
      <button type="button" className="pn-btn pn-btn--secondary pn-report__action" onClick={onRetry}>
        {t.tryAgain}
      </button>
    </div>
  );
}
