"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FILIPINO_ENABLED } from "@/i18n/locales";
import { setLocale, useLocale } from "@/i18n/provider";
import { AppIconTile, Wordmark } from "@/ui/brand/route-n-mark";

export const SECTIONS = [
  { href: "#how", label: "How it works" },
  { href: "#ride", label: "Ways to ride" },
  { href: "#honest", label: "Our data" },
  { href: "#faq", label: "FAQ" },
];

/** EN | FIL: writes the same pref as More, so the app opens in the language picked here. */
function LanguageToggle({ className }: { className: string }) {
  const locale = useLocale();
  if (!FILIPINO_ENABLED) return null;
  return (
    <div role="group" aria-label="Language" className={className}>
      {([["en", "EN", "English"], ["fil", "FIL", "Filipino"]] as const).map(([code, text, name]) => (
        <button key={code} type="button" lang={code} aria-label={name} aria-pressed={locale === code} onClick={() => setLocale(code)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** Floating pill header; on small screens the sections open in a sheet under it (never shifts the page). */
export function SiteHeader() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="pnl-header">
      <nav aria-label="Main" className="pnl-header__bar">
        <a href="#top" className="pnl-header__brand" aria-label="ParaNaga, back to top">
          <AppIconTile size={32} />
          <Wordmark className="pnl-header__word text-xl" />
        </a>
        <div className="pnl-header__links">
          {SECTIONS.map((s) => (
            <a key={s.href} href={s.href}>
              {s.label}
            </a>
          ))}
        </div>
        <LanguageToggle className="pnl-header__lang pnl-header__lang--bar" />
        <Link href="/app" className="pnl-btn pnl-btn--bright pnl-header__cta">
          Open the app
        </Link>
        <button
          type="button"
          className="pnl-header__menu"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            {open ? <path d="M4 4l10 10M14 4L4 14" /> : <path d="M3 6h12M3 12h12" />}
          </svg>
        </button>
      </nav>
      <div id="mobile-menu" className="pnl-header__sheet" data-open={open} inert={!open}>
        <div>
          <LanguageToggle className="pnl-header__lang pnl-header__lang--sheet" />
          {SECTIONS.map((s) => (
            <a key={s.href} href={s.href} onClick={() => setOpen(false)}>
              {s.label}
              <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden opacity="0.6">
                <path d="M1 1l6 6-6 6" />
              </svg>
            </a>
          ))}
        </div>
      </div>
    </header>
  );
}
