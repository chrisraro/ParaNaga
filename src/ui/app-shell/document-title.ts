"use client";

// Names the tab for a screen whose route only has a static title (the article or not-found text is
// runtime data). The route's own <title> streams in with the page's metadata, which can resolve
// after this screen rendered and would overwrite the name; so the title is set again whenever
// something else changes it while the screen is mounted. The layout-effect cleanup runs in the same
// commit that removes the screen, before the next route's title is applied, so it never fights it.
// Mounted screens form a stack and the newest names the tab (a panel over a tab page): when it
// leaves, the one under it names the tab again, and when the last leaves, the title from before the
// first comes back (a panel over the map). A screen whose title changes keeps its place in the
// stack, so a page under a panel never takes the tab from it. Hidden routes (Activity) run no effects.

import { useLayoutEffect, useRef } from "react";

type Entry = { mine?: string };
const stack: Entry[] = [];
let base = "";
let observer: MutationObserver | null = null;

function top(): string | undefined {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i]?.mine) return stack[i]?.mine;
  return undefined;
}

function apply() {
  const now = top();
  if (now && document.title !== now) document.title = now;
}

/** Change the stack, then make the tab title follow it. */
function change(mutate: () => void) {
  const before = top();
  if (!before) base = document.title;
  mutate();
  const now = top();
  if (now) apply();
  else if (before && document.title === before) document.title = base;
  if (now && !observer) {
    observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
  } else if (!now && observer) {
    observer.disconnect();
    observer = null;
  }
}

export function useDocumentTitle(title: string | undefined) {
  const entry = useRef<Entry>({});
  useLayoutEffect(() => {
    const me = entry.current;
    change(() => stack.push(me));
    return () => change(() => stack.splice(stack.indexOf(me), 1));
  }, []);
  useLayoutEffect(() => {
    // `document.title` reads back with its white space collapsed: compare like with like, or the
    // observer would set the title for ever.
    const me = entry.current;
    change(() => {
      me.mine = title ? `${title} · Lunad`.replace(/\s+/g, " ").trim() : undefined;
    });
  }, [title]);
}

/** For a screen that knows its heading only after the early returns of loading and error states. */
export function DocumentTitle({ title }: { title: string }) {
  useDocumentTitle(title);
  return null;
}
