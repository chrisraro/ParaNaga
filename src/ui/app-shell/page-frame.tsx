"use client";

// Frame of a tab page (Explore, Saved, More): like DetailPanel (src/ui/detail/detail-frame.tsx) a
// full-screen panel over the home map, which stays mounted and inert underneath, but with a large
// title instead of a Back button, and the tab bar stays visible over it (the body leaves room for
// it). Focus moves to the h1 when the page opens; Escape goes back like on every other panel.

import "@/ui/detail/detail.css";
import "@/ui/kit/styles";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { useEscapeToClose, useFocusOnMount } from "./panel";
import { ScreenHeader } from "@/ui/kit/screen-header";
import { useAppFrame, useAppPanel } from "./app-frame-context";

type Props = {
  title: string;
  /** Round action right of the title (Explore's search). */
  action?: ReactNode;
  /** Under the title: an intro line or a segmented control. */
  header?: ReactNode;
  children: ReactNode;
  testId?: string;
};

export function PageFrame({ title, action, header, children, testId }: Props) {
  useAppPanel("page");
  const root = useRef<HTMLDivElement>(null);
  useEscapeToClose(root);
  const heading = useFocusOnMount<HTMLHeadingElement>(true);
  const clearance = useAppFrame()?.tabBarClearance ?? 0;
  const style = { "--pn-tabbar-clearance": `${clearance}px` } as CSSProperties;
  return (
    <div ref={root} className="pn-detail pn-page" style={style} data-testid={testId}>
      <ScreenHeader title={title} headingRef={heading} action={action}>
        {header}
      </ScreenHeader>
      <main className="pn-page__main">{children}</main>
    </div>
  );
}
