"use client";

// MyNaga handoff (artboard MyNagaHandoff, informational version; decision D9). ParaNaga has no
// driver report yet (Increment B), so nothing is prepared, copied, sent or recorded here: the
// screen says what to have ready and opens one of MyNaga's four verified public entry points
// (src/domain/mynaga/links.ts) in a new tab, exactly as written (no deep link, nothing appended).
// The store that matches this phone is listed first. Step 3 of the artboard ("Tell us if you
// submitted it") becomes an unnumbered "After you submit in MyNaga" with a plain note until
// private reports exist.

import "@/ui/kit/styles";
import "@/ui/help/help.css";

import { useSyncExternalStore } from "react";
import { detectPlatform, mynagaLinksFor, type Platform } from "@/domain/mynaga/links";
import { DetailPanel, useFocusOnMount } from "@/ui/detail/detail-frame";
import { Note } from "@/ui/kit/note";

export const PREPARE_ITEMS = [
  "When it happened (date and time)",
  "Route and direction, if you know them",
  "Plate or body number, if you saw it",
  "What happened, in your own words",
  "Photos you are entitled to share",
] as const;
export const LATER_NOTE = "Private ParaNaga reports, with a summary you can copy and a place to note your MyNaga reference, arrive later.";
export const MYNAGA_FOOTER = "We can't see or confirm what happens in MyNaga.";

const noSubscribe = () => () => undefined;
const clientPlatform = (): Platform => detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0);
const serverPlatform = (): Platform => "other";

function ExternalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="16" height="16" rx="4" />
    </svg>
  );
}

function StepTitle({ n, id, children }: { n: number; id: string; children: string }) {
  return (
    <h2 id={id} className="pn-mynaga__step-title">
      <span className="pn-mynaga__num" aria-hidden="true">
        {n}
      </span>
      {children}
    </h2>
  );
}

export function MyNagaScreen() {
  const heading = useFocusOnMount<HTMLHeadingElement>(true);
  const platform = useSyncExternalStore(noSubscribe, clientPlatform, serverPlatform);
  const links = mynagaLinksFor(platform);
  return (
    <DetailPanel title="MyNaga" testId="mynaga-page">
      <main className="pn-detail__main pn-detail-in">
        <h1 ref={heading} tabIndex={-1} className="pn-detail__title">
          Report in MyNaga
        </h1>
        <Note tone="warning" testId="mynaga-independent">
          <strong>ParaNaga is independent.</strong> It is not affiliated with MyNaga or the City Government and is not an official channel. Opening MyNaga does not submit your report.
        </Note>

        <section className="pn-mynaga__step" aria-labelledby="pn-mynaga-s1">
          <StepTitle n={1} id="pn-mynaga-s1">
            Prepare what you will share
          </StepTitle>
          <ul className="pn-group" data-testid="mynaga-prepare">
            {PREPARE_ITEMS.map((item) => (
              <li key={item} className="pn-mynaga__check">
                <CheckIcon />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="pn-mynaga__step" aria-labelledby="pn-mynaga-s2">
          <StepTitle n={2} id="pn-mynaga-s2">
            Open MyNaga and submit there
          </StepTitle>
          <ul className="pn-mynaga__links" data-testid="mynaga-links">
            {links.map((link, i) => (
              <li key={link.id}>
                <a
                  className={i === 0 ? "pn-mynaga__link pn-mynaga__link--primary" : "pn-mynaga__link"}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${link.label} (opens in a new tab)`}
                  data-testid={`mynaga-link-${link.id}`}
                >
                  {link.label}
                  <ExternalIcon />
                </a>
              </li>
            ))}
          </ul>
        </section>

        {/* Not a numbered step: nothing to do here yet (the artboard's "Tell us if you submitted it"). */}
        <section className="pn-mynaga__step" aria-labelledby="pn-mynaga-after">
          <h2 id="pn-mynaga-after" className="pn-mynaga__step-title">
            After you submit in MyNaga
          </h2>
          <Note testId="mynaga-later">{LATER_NOTE}</Note>
        </section>

        <Note testId="mynaga-footer">{MYNAGA_FOOTER}</Note>
      </main>
    </DetailPanel>
  );
}
