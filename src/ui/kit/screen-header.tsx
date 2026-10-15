"use client";

// Large-title header of a tab page (artboards Settings, Saved, Explore: 34 px bold title, optional
// round action on the right such as Explore's search) with an optional round Back button above it
// for pages opened from another page. The h1 takes focus when the screen opens (focus moves to
// each screen's h1), so a screen reader starts at the title.

import "./styles";

import type { ReactNode, Ref } from "react";
import { BackButton } from "@/ui/detail/detail-frame";

type Props = {
  title: string;
  headingRef?: Ref<HTMLHeadingElement>;
  /** Round Back button above the title (history back inside the app, else the map). */
  back?: boolean;
  /** Round action on the right of the title (a 44 px link or button). */
  action?: ReactNode;
  /** Content under the title: an intro line or a segmented control. */
  children?: ReactNode;
};

export function ScreenHeader({ title, headingRef, back = false, action, children }: Props) {
  return (
    <header className="pn-screen-header">
      {back ? (
        <div className="pn-screen-header__back">
          <BackButton />
        </div>
      ) : null}
      <div className="pn-screen-header__bar">
        <h1 ref={headingRef} tabIndex={-1} className="pn-detail__title">
          {title}
        </h1>
        {action ?? null}
      </div>
      {children}
    </header>
  );
}
