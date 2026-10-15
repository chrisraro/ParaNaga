"use client";

// Terminal detail (artboard TerminalDetail; Increment A, Task 6) from GET /api/v1/terminals/:code.
// No terminal has a location on file (no coordinates, entrances, bays or hours), so there is no
// map and no "Directions to the terminal" button: a note says why. The Routes tab lists the
// routes whose legal plan or Nov 2025 trial circuit names the terminal, then its regional
// destination categories (services not verified). "Help map an entrance" is not offered until
// corrections open (no dead buttons).

import "@/ui/kit/styles";
import "@/ui/places/places.css";

import Link from "next/link";
import { useId, useState } from "react";
import { useNetworkResource } from "@/client/network/use-network-resource";
import { terminalDetailSchema, type TerminalDetail } from "@/domain/api/schemas";
import {
  terminalEvidenceLabel,
  terminalModesText,
  terminalNoteSentences,
  terminalRouteSub,
} from "@/domain/places/place-detail";
import { regionalCategoryLabel } from "@/domain/search/search";
import { DetailError, DetailLoading, DetailNotFound, DetailPanel, useFocusOnMount } from "@/ui/detail/detail-frame";
import { StatusBadge } from "@/ui/kit/badge";
import { ListChevron } from "@/ui/kit/list";
import { Note } from "@/ui/kit/note";
import { Segmented } from "@/ui/kit/segmented";
import { LoopChip } from "@/ui/trip/trip-parts";

const TITLE = "Terminal";

export function TerminalDetailScreen({ code }: { code: string }) {
  const resource = useNetworkResource(`/api/v1/terminals/${encodeURIComponent(code)}`, terminalDetailSchema);
  if (resource.status === "loading") return <DetailLoading title={TITLE} />;
  if (resource.status === "not_found") return <DetailNotFound what="terminal" />;
  if (resource.status === "error") return <DetailError title={TITLE} offline={resource.offline} onRetry={resource.retry} />;
  return <TerminalDetailView data={resource.data} />;
}

type Tab = "routes" | "entrances" | "hours";

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.01" />
    </svg>
  );
}

function RoutesPanel({ data }: { data: TerminalDetail }) {
  const { routes, destinationCategories } = data;
  const uid = useId();
  return (
    <>
      {routes.length === 0 ? (
        <p className="pn-cell pn-cell--empty pn-group" data-testid="terminal-no-routes">
          No route plan names this terminal yet.
        </p>
      ) : (
        <ul className="pn-group" data-testid="terminal-routes">
          {routes.map((r) => (
            <li key={`${r.routeCode}:${r.basis}`}>
              <Link href={`/app/routes/${encodeURIComponent(r.routeCode)}`} className="pn-cell" data-testid={`terminal-route-${r.basis}`}>
                <LoopChip leg={{ routeCode: r.routeCode, routeName: r.routeName }} icon="line" />
                <span className="pn-cell__text">
                  <span className="pn-cell__title">{r.routeName}</span>
                  <span className="pn-cell__sub">{terminalRouteSub(r.basis)}</span>
                  {r.basis === "trial" ? <StatusBadge variant="trial" /> : null}
                </span>
                <ListChevron />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {destinationCategories.length > 0 ? (
        <section className="pn-section" aria-labelledby={`${uid}-regional`}>
          <h2 id={`${uid}-regional`} className="pn-section__title">
            Regional destinations
          </h2>
          <ul className="pn-group" data-testid="terminal-destinations">
            {destinationCategories.map((c) => (
              <li key={c.category} className="pn-cell">
                <span className="pn-cell__text">
                  <span className="pn-cell__title">
                    {regionalCategoryLabel(c.category)}: {c.destinations.join(", ")} · services not verified
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {routes.length > 0 || destinationCategories.length > 0 ? (
        <p className="pn-footnote">From the legal route plan. Bays and regional services are not mapped yet.</p>
      ) : null}
    </>
  );
}

export function TerminalDetailView({ data }: { data: TerminalDetail }) {
  const { terminal } = data;
  const heading = useFocusOnMount<HTMLHeadingElement>(true);
  const uid = useId();
  const [tab, setTab] = useState<Tab>("routes");
  const panelId = `${uid}-panel`;
  const notes = terminalNoteSentences(terminal.code, data.destinationCategories.length > 0);
  const sub = [terminalModesText(terminal.modes), terminal.locationText].filter(Boolean).join(" · ");
  // Only the terminal's own sources back its address; the route and trial sources say nothing
  // about it, so none → no chips (the evidence label then says "no evidence on file").
  const sourceChips = terminal.sourceCodes;
  const tabs = [
    { value: "routes", label: "Routes", controls: panelId, id: `${uid}-tab-routes` },
    { value: "entrances", label: "Entrances", controls: panelId, id: `${uid}-tab-entrances` },
    { value: "hours", label: "Hours", controls: panelId, id: `${uid}-tab-hours` },
  ] as const;
  const activeTabId = tabs.find((t) => t.value === tab)!.id;

  return (
    <DetailPanel title={TITLE} action={<span className="pn-terminal__pill" data-testid="terminal-pill">Location not mapped</span>} testId="terminal-detail">
      <main className="pn-detail__main pn-detail-in">
        <div className="pn-place__head">
          <h1 ref={heading} tabIndex={-1} className="pn-detail__title">
            {terminal.name}
          </h1>
          {sub ? (
            <p className="pn-place__kind" data-testid="terminal-sub">
              {sub}
            </p>
          ) : null}
          <div className="pn-detail__row">
            <StatusBadge variant="documented" />
            <span className="pn-terminal__address" data-testid="terminal-address">
              Address: {terminalEvidenceLabel(terminal.evidenceStatus)}
              {sourceChips.map((c) => (
                <span key={c}>
                  {" "}
                  <span className="pn-mono">{c}</span>
                </span>
              ))}
            </span>
          </div>
        </div>

        {notes.length > 0 ? (
          <div role="note" className="pn-terminal__info" data-testid="terminal-note">
            <InfoIcon />
            <span>{notes.join(" ")}</span>
          </div>
        ) : null}

        <Segmented options={tabs} value={tab} onChange={setTab} label="Terminal sections" variant="tablist" testId="terminal-tabs" />

        <div id={panelId} role="tabpanel" aria-labelledby={activeTabId} className="pn-terminal__panel" data-testid={`terminal-panel-${tab}`}>
          {tab === "routes" ? <RoutesPanel data={data} /> : null}
          {tab === "entrances" ? (
            <div className="pn-terminal__empty">
              <p className="pn-terminal__empty-title">No entrances surveyed yet</p>
              <p className="pn-terminal__empty-text">ParaNaga has no location for this terminal yet, so trips can&apos;t start or end here.</p>
            </div>
          ) : null}
          {tab === "hours" ? (
            <dl className="pn-group pn-terminal__hours" data-testid="terminal-hours">
              <div className="pn-kv">
                <dt className="pn-kv__key">Opening hours</dt>
                <dd className="pn-kv__value">Not on file</dd>
              </div>
              <div className="pn-kv">
                <dt className="pn-kv__key">Evidence</dt>
                <dd className="pn-kv__value">None on file</dd>
              </div>
            </dl>
          ) : null}
        </div>

        <Note testId="terminal-directions-note">Directions unavailable until the terminal&apos;s location is mapped.</Note>
      </main>
    </DetailPanel>
  );
}
