"use client";

// Help (artboard Help; Increment A, Task 11): Help · Safety · About data, opened from More. The
// section is in the URL (?tab=help|safety|data), changed in place with history.replaceState like
// Saved. Differences from the artboard, on purpose:
//  - Help: "Report a correction", the private driver report and "My reports" arrive in Increment
//    B; "Report a problem with a driver" opens the MyNaga handoff instead (D9).
//  - Safety: the emergency number is the national 911, as the spec prescribes
//    (docs/spec/02-features.md:104, "urgent situations show official emergency numbers (911)").
//    TODO(data task): add a sources-register row for the national Emergency 911 hotline with a
//    checked date, so the number is traceable from the app. "does not monitor reports"
//    without "in real time" (nothing is monitored at all); the tips say only what the data allows
//    (no stop side, no verified signboards); the button opens MyNaga, not a private report.
//  - About data: every badge says what it means today (nothing is verified; Loops A and B plan on
//    mapped candidates) and the "Unverified route" badge is explained too.

import "@/ui/kit/styles";
import "./help.css";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ListCell, ListGroup } from "@/ui/kit/list";
import { Note } from "@/ui/kit/note";
import { Segmented, type SegmentedOption } from "@/ui/kit/segmented";
import { StatusBadge, type BadgeVariant } from "@/ui/kit/badge";
import { SOURCES_HREF } from "./sources-href";
import { ARTICLES, articleHref, type ArticleSlug } from "./articles";

export type HelpTab = "help" | "safety" | "data";
const TABS: readonly HelpTab[] = ["help", "safety", "data"];

export function parseHelpTab(raw: string | null): HelpTab {
  return TABS.includes(raw as HelpTab) ? (raw as HelpTab) : "help";
}

export const INDEPENDENT_NOTE = "ParaNaga is an independent commuter guide. It is not an official City Government app.";
export const DATA_FOOTER = "ParaNaga does not track vehicles, so it cannot say when one will come. Stop alerts work only while ParaNaga is open on your screen.";
export const SAFETY_TIPS = [
  "Wait off the road, where other passengers wait.",
  "Ask the driver where the jeepney goes before you board; signboards are not verified yet.",
  "Keep valuables in front of you in crowded vehicles.",
  "Note the plate or body number if something feels wrong.",
  "Share your trip summary with someone you trust.",
] as const;
export const BADGE_MEANINGS: readonly { variant: BadgeVariant; text: string }[] = [
  { variant: "verified", text: "Checked in the field. Nothing in Naga yet." },
  { variant: "candidate", text: "From a public map, not checked." },
  { variant: "documented", text: "Named in documents; no mapped location." },
  { variant: "unverified-route", text: "Built from mapped pins. Confirm with the driver." },
  { variant: "approximate-path", text: "Traced along roads between pins. Not a surveyed shape." },
];

const ICON = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false } as const;

const ARTICLE_ICONS: Record<ArticleSlug, string> = {
  "how-trips-are-planned": "M4 19c4 0 4-14 8-14s4 14 8 14",
  "why-stops-are-not-verified": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6M12 17h.01",
  "using-paranaga-offline": "M3 10a13 13 0 0 1 18 0M6.5 13.5a8 8 0 0 1 11 0M10 17a3 3 0 0 1 4 0M4 4l16 16",
  "how-times-are-estimated": "M12 8v4l3 3M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z",
  "vehicle-types-in-naga": "M5 18H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2M10 18H8M7 18a2 2 0 1 1-4 0M17 18a2 2 0 1 1-4 0",
};

function Tile({ d }: { d: string }) {
  return (
    <span className="pn-help__icon">
      <svg {...ICON}>
        <path d={d} />
      </svg>
    </span>
  );
}

function HelpPanel() {
  return (
    <>
      <ListGroup label="Help topics" testId="help-links">
        {ARTICLES.map((a) => (
          <ListCell key={a.slug} lead={<Tile d={ARTICLE_ICONS[a.slug]} />} title={a.title} href={articleHref(a.slug)} compact testId={`help-link-${a.slug}`} />
        ))}
        <ListCell lead={<Tile d="M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z" />} title="Report a problem with a driver" href="/app/mynaga" compact testId="help-link-mynaga" />
      </ListGroup>
      <Note testId="help-independent">{INDEPENDENT_NOTE}</Note>
    </>
  );
}

function SafetyPanel() {
  return (
    <>
      <div className="pn-help__emergency" data-testid="help-emergency">
        <svg {...ICON} width={22} height={22}>
          <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
        </svg>
        <p>
          <strong>In an emergency, call 911.</strong> ParaNaga does not monitor reports and cannot send help.
        </p>
      </div>
      <section className="pn-section" aria-labelledby="pn-help-tips">
        <h2 id="pn-help-tips" className="pn-section__title">
          Commuting safely
        </h2>
        <ul className="pn-group" data-testid="help-tips">
          {SAFETY_TIPS.map((tip) => (
            <li key={tip} className="pn-help__tip">
              <svg {...ICON} width={18} height={18} strokeWidth={2.4}>
                <path d="M5 12l5 5L20 7" />
              </svg>
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      </section>
      <Link href="/app/report-driver" className="pn-help__report" data-testid="help-report-driver-private">
        Report a driver privately in ParaNaga
      </Link>
      <Link href="/app/mynaga" className="pn-help__report" data-testid="help-report-driver">
        Report a driver to the City in MyNaga
      </Link>
    </>
  );
}

function DataPanel() {
  return (
    <>
      <section className="pn-section" aria-labelledby="pn-help-badges">
        <h2 id="pn-help-badges" className="pn-section__title">
          What the badges mean
        </h2>
        <ul className="pn-group" data-testid="help-badges">
          {BADGE_MEANINGS.map((b) => (
            <li key={b.variant} className="pn-help__badge-row">
              <StatusBadge variant={b.variant} />
              <p>{b.text}</p>
            </li>
          ))}
        </ul>
      </section>
      <ListGroup label="Data" testId="help-data">
        <ListCell title="Sources and credits" href={SOURCES_HREF} compact testId="help-sources-link" />
      </ListGroup>
      <Note testId="help-data-footer">{DATA_FOOTER}</Note>
    </>
  );
}

const TAB_OPTIONS: readonly SegmentedOption<HelpTab>[] = [
  { value: "help", label: "Help", id: "pn-help-tab-help", controls: "pn-help-panel" },
  { value: "safety", label: "Safety", id: "pn-help-tab-safety", controls: "pn-help-panel" },
  { value: "data", label: "About data", id: "pn-help-tab-data", controls: "pn-help-panel" },
];

const PANELS: Record<HelpTab, () => ReactNode> = { help: HelpPanel, safety: SafetyPanel, data: DataPanel };

export function HelpScreen() {
  const params = useSearchParams();
  const fromUrl = parseHelpTab(params.get("tab"));
  // Kept in step with ?tab= when a navigation changes it (Back from an article); a tap replaces
  // the URL in place (no navigation, no request).
  const [tab, setTab] = useState(fromUrl);
  const [seenUrl, setSeenUrl] = useState(fromUrl);
  if (fromUrl !== seenUrl) {
    setSeenUrl(fromUrl);
    setTab(fromUrl);
  }
  const choose = (next: HelpTab) => {
    setTab(next);
    window.history.replaceState(window.history.state, "", next === "help" ? "/app/help" : `/app/help?tab=${next}`);
  };
  return (
    <div className="pn-help" data-testid="help-screen">
      <Segmented options={TAB_OPTIONS} value={tab} onChange={choose} label="Help sections" variant="tablist" testId="help-tabs" />
      <div id="pn-help-panel" role="tabpanel" aria-labelledby={`pn-help-tab-${tab}`} className="pn-help__panel" tabIndex={0} data-testid={`help-panel-${tab}`}>
        {PANELS[tab]()}
      </div>
    </div>
  );
}
