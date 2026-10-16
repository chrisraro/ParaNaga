"use client";

// The primary action of a sheet screen ("Start trip", the guidance step buttons) is rendered into
// the sheet's footer slot (src/ui/home/endpoint-sheet.tsx), outside the scrolling content and on
// the sheet's own transform, so it is inside the visible sheet at every snap, above the tab bar.
// Without a sheet (unit tests, the first render) it renders in place.

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const SheetFooterContext = createContext<HTMLElement | null>(null);

export function SheetBar({ className, children }: { className?: string; children: ReactNode }) {
  const footer = useContext(SheetFooterContext);
  const inner = <div className={className}>{children}</div>;
  return footer ? createPortal(inner, footer) : inner;
}
