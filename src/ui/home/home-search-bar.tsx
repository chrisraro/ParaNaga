"use client";

// The map-first Home's top chrome: the floating "Where to?" bar (a link to Search for the
// destination) and the chip row under it. Saved places come first and set the destination on a tap;
// the place categories open Explore filtered to that category (home-chips.ts). Route and terminal
// layers stay in the Layers button.

import Link from "next/link";
import { ViewTransition, type Ref } from "react";
import { useIsOffline } from "@/client/pwa/connectivity";
import { useSavedPlaces } from "@/client/saved/use-saved";
import { useT } from "@/i18n/provider";
import { useAppFrame } from "@/ui/app-shell/app-frame-context";
import { homeChips } from "./home-chips";

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M20 20l-3.5-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 3h12v18l-6-4.5L6 21z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}

export function HomeSearchBar({ searchRef }: { searchRef: Ref<HTMLAnchorElement> }) {
  const tt = useT();
  const home = tt.home;
  const frame = useAppFrame();
  const saved = useSavedPlaces();
  // Offline a soft navigation cannot reach the server: plain links, so the service worker answers (as in the tab bar).
  const Anchor = useIsOffline() ? "a" : Link;
  const chips = homeChips(saved.status === "ready" ? saved.records : [], tt.explore);
  return (
    <div className="pn-home-top">
      <ViewTransition name="pn-search-field">
        <Anchor ref={searchRef} href="/app/search?for=destination" className="pn-home-search" aria-label={home.searchLabel} data-testid="home-search">
          <SearchIcon />
          <span>{home.whereTo}</span>
        </Anchor>
      </ViewTransition>
      <ul className="pn-home-chips" aria-label={home.browsePlaces} data-testid="home-chips">
        {chips.map((chip) => (
          <li key={`${chip.kind}-${chip.id}`}>
            {chip.kind === "saved" ? (
              <button
                type="button"
                className="pn-home-chip pn-home-chip--saved"
                data-testid={`home-chip-saved-${chip.id}`}
                onClick={() => frame?.requestEndpoint("destination", { point: { ...chip.place.point }, label: chip.place.label, place: chip.place.source })}
              >
                <BookmarkIcon />
                <span>{chip.label}</span>
              </button>
            ) : (
              <Anchor href={chip.href} className="pn-home-chip" data-testid={`home-chip-${chip.id}`}>
                {chip.label}
              </Anchor>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
