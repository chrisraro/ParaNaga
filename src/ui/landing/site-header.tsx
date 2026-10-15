"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppIconTile, Wordmark } from "@/ui/brand/route-n-mark";

const SECTIONS = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#data", label: "Our data" },
  { href: "#faq", label: "FAQ" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-navy/75 backdrop-blur-xl backdrop-saturate-150">
      <nav aria-label="Main" className="mx-auto flex min-h-16 max-w-[1180px] items-center gap-3 px-4 py-2.5 md:gap-6 md:px-8">
        <a href="#top" className="mr-auto flex min-h-11 items-center gap-2.5 text-white">
          <AppIconTile size={30} />
          <Wordmark className="text-xl" />
        </a>
        <div className="hidden gap-6 text-sm md:flex">
          {SECTIONS.map((s) => (
            <a key={s.href} href={s.href} className="text-white/80 transition-colors hover:text-white">
              {s.label}
            </a>
          ))}
        </div>
        <Link
          href="/app"
          className="flex h-10 shrink-0 items-center rounded-full bg-teal-bright px-4 text-sm font-bold text-on-teal-bright transition-transform active:scale-[0.97]"
        >
          <span className="md:hidden">Open app</span>
          <span className="hidden md:inline">Open the app</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-transform active:scale-[0.97] md:hidden"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            {open ? <path d="M4 4l10 10M14 4L4 14" /> : <path d="M3 6h12M3 12h12" />}
          </svg>
        </button>
      </nav>
      {/* An overlay below the sticky header (out of the page flow), so opening or closing it never
          shifts the page: a section link lands its heading just below the header (scroll-mt). */}
      <div
        id="mobile-menu"
        className={`absolute inset-x-0 top-full grid bg-navy transition-[grid-template-rows,opacity] duration-400 ease-sheet md:hidden ${
          open ? "grid-rows-[1fr] border-t border-white/10 opacity-100 shadow-[0_18px_40px_rgba(0,0,0,0.3)]" : "grid-rows-[0fr] opacity-0"
        }`}
        inert={!open}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col px-4 pb-5 pt-1">
            {SECTIONS.map((s) => (
              <a
                key={s.href}
                href={s.href}
                onClick={() => setOpen(false)}
                className="flex min-h-13 items-center justify-between border-b border-white/10 text-lg font-semibold tracking-tight text-white"
              >
                {s.label}
                <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="opacity-50">
                  <path d="M1 1l6 6-6 6" />
                </svg>
              </a>
            ))}
            <p className="mt-3.5 text-[13px] text-white/60">Made for your phone · Free · No account needed</p>
          </div>
        </div>
      </div>
    </header>
  );
}
