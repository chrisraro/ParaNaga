"use client";

// The app frame's offline banner (spec §3.11): "Offline — data from {date}. Fares may have
// changed." The date is the published date of the data this phone holds: the snapshot in memory,
// else the revision last seen (IndexedDB snapshotMeta). The live region is always mounted so the
// change is announced; it never blocks the map (pointer-events: none).

import "./pwa.css";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useIsOffline } from "@/client/pwa/connectivity";
import { useSnapshot } from "@/client/network/use-snapshot";
import { readSnapshotMeta } from "@/client/storage/db";
import { offlineBannerText } from "@/domain/pwa/offline-copy";
import type { SnapshotMeta } from "@/domain/saved/saved";

export function OfflineBanner() {
  const offline = useIsOffline();
  // Read only: the home screen loads the snapshot.
  const { snapshot } = useSnapshot(false);
  // undefined: not read yet; null: nothing stored (or storage unavailable).
  const [meta, setMeta] = useState<SnapshotMeta | null | undefined>(undefined);
  useEffect(() => {
    if (!offline) return undefined;
    let live = true;
    readSnapshotMeta().then(
      (m) => live && setMeta(m),
      () => live && setMeta(null),
    );
    return () => {
      live = false;
    };
  }, [offline]);

  const known = snapshot !== null || meta !== undefined;
  const banner = useRef<HTMLParagraphElement>(null);
  const text = offline && known ? offlineBannerText(snapshot?.revision.publishedAt ?? meta?.publishedAt, snapshot !== null || Boolean(meta)) : null;
  // While it shows, every screen's top chrome (panel headers, map controls, search bar) moves down
  // by its height (--pn-offline-inset), so the banner never covers a Back button or a title.
  useLayoutEffect(() => {
    const el = banner.current;
    const root = document.documentElement;
    if (!el) {
      root.style.removeProperty("--pn-offline-inset");
      return undefined;
    }
    const measure = () => root.style.setProperty("--pn-offline-inset", `${Math.ceil(el.getBoundingClientRect().height) + 8}px`);
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty("--pn-offline-inset");
    };
  }, [text]);

  return (
    <div className="pn-pwa" role="status" data-testid="offline-status">
      {text ? (
        <p ref={banner} className="pn-offline-banner" data-testid="offline-banner">
          {text}
        </p>
      ) : null}
    </div>
  );
}
