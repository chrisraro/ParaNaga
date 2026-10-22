"use client";

// MyNaga handoff (artboard MyNagaHandoff, informational version; decision D9). Nothing is
// prepared, copied, sent or recorded here (private driver reports are separate, behind
// DRIVER_REPORTS_ENABLED, N2): the screen says what to have ready and opens one of MyNaga's four verified public entry points
// (src/domain/mynaga/links.ts) in a new tab, exactly as written (no deep link, nothing appended).
// The store that matches this phone is listed first. Step 3 of the artboard ("Tell us if you
// submitted it") becomes an unnumbered "After you submit in MyNaga" with a plain note about
// private reports.

import "@/ui/kit/styles";
import "@/ui/help/help.css";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { detectPlatform, mynagaLinksFor, type Platform } from "@/domain/mynaga/links";
import { DetailPanel, useFocusOnMount } from "@/ui/detail/detail-frame";
import { Note } from "@/ui/kit/note";
import { en } from "@/i18n/dict";
import { useT } from "@/i18n/provider";
import { ReportHandoff } from "./report-handoff";

export const PREPARE_ITEMS = Object.values(en.mynaga.prepare);
export const LATER_NOTE = en.mynaga.later;
export const MYNAGA_FOOTER = en.mynaga.footer;

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

export function MyNagaScreen({ reportId }: { reportId?: string } = {}) {
  const tt = useT();
  const t = tt.mynaga;
  const heading = useFocusOnMount<HTMLHeadingElement>(true);
  const platform = useSyncExternalStore(noSubscribe, clientPlatform, serverPlatform);
  const links = mynagaLinksFor(platform);
  const linksStep = (
    <section className="pn-mynaga__step" aria-labelledby="pn-mynaga-s2">
          <StepTitle n={2} id="pn-mynaga-s2">
            {t.openTitle}
          </StepTitle>
          <ul className="pn-mynaga__links" data-testid="mynaga-links">
            {links.map((link, i) => (
              <li key={link.id}>
                <a
                  className={i === 0 ? "pn-mynaga__link pn-mynaga__link--primary" : "pn-mynaga__link"}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={tt.forms.opensNewTab(t.links[link.id])}
                  data-testid={`mynaga-link-${link.id}`}
                >
                  {t.links[link.id]}
                  <ExternalIcon />
                </a>
              </li>
            ))}
          </ul>
        </section>

 );
  return (
    <DetailPanel title={t.panelTitle} testId="mynaga-page">
      <main className="pn-detail__main pn-detail-in">
        <h1 ref={heading} tabIndex={-1} className="pn-detail__title">
          {t.title}
        </h1>
        <Note tone="warning" testId="mynaga-independent">
          <strong>{t.independentStrong}</strong> {t.independentBody}
        </Note>

        {reportId ? (
          <ReportHandoff id={reportId} links={linksStep} />
        ) : (
          <>
            <section className="pn-mynaga__step" aria-labelledby="pn-mynaga-s1">
              <StepTitle n={1} id="pn-mynaga-s1">
                {t.prepareTitle}
              </StepTitle>
              <ul className="pn-group" data-testid="mynaga-prepare">
                {Object.values(t.prepare).map((item) => (
                  <li key={item} className="pn-mynaga__check">
                    <CheckIcon />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            {linksStep}

            {/* Not a numbered step: the self-report lives on a report's own handoff screen. */}
            <section className="pn-mynaga__step" aria-labelledby="pn-mynaga-after">
              <h2 id="pn-mynaga-after" className="pn-mynaga__step-title">
                {t.afterTitle}
              </h2>
              <Note testId="mynaga-later">{t.later}</Note>
              <Link href="/app/reports" className="pn-mynaga__link" data-testid="mynaga-reports-link">
                {t.myReports}
              </Link>
            </section>
          </>
        )}

        <Note testId="mynaga-footer">{t.footer}</Note>
      </main>
    </DetailPanel>
  );
}
