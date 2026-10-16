"use client";

// Names the tab for a screen whose route only has a static title (the article or not-found text is
// runtime data). The route's own <title> streams in with the page's metadata, which can resolve
// after this screen rendered and would overwrite the name; so the title is set again whenever
// something else changes it while the screen is mounted. The layout-effect cleanup runs in the same
// commit that removes the screen, before the next route's title is applied, so it never fights it.

import { useLayoutEffect } from "react";

export function useDocumentTitle(title: string | undefined) {
  useLayoutEffect(() => {
    if (!title) return undefined;
    const previous = document.title;
    const mine = `${title} · ParaNaga`;
    const apply = () => {
      if (document.title !== mine) document.title = mine;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      if (document.title === mine) document.title = previous;
    };
  }, [title]);
}
