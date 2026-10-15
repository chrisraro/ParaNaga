// Notes. "plain" is the left-aligned footnote the audit asked for (F-08): muted text, no pill and
// no box, for "not yet" facts ("Nothing saved on this phone yet."), so it never looks like a
// control. "warning" is the existing amber box (.pn-note, role=note) for partial or unverified data.

import "./styles";

import type { ReactNode } from "react";

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18v.01" />
    </svg>
  );
}

type Props = { children: ReactNode; tone?: "plain" | "warning"; icon?: boolean; testId?: string };

export function Note({ children, tone = "plain", icon = false, testId }: Props) {
  if (tone === "warning") {
    return (
      <div role="note" className="pn-note pn-note--small" data-testid={testId}>
        <WarningIcon />
        <p>{children}</p>
      </div>
    );
  }
  return (
    <p className="pn-note-plain" data-testid={testId}>
      {icon ? <InfoIcon /> : null}
      <span>{children}</span>
    </p>
  );
}
