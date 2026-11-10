"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FILIPINO_ENABLED } from "@/i18n/locales";
import { setLocale, useLocale, useT } from "@/i18n/provider";
import { LunadMark, LunadWordmark } from "@/ui/brand/lunad-mark";

const SECTIONS = [
  { href: "#how", key: "how" },
  { href: "#ride", key: "ride" },
  { href: "#honest", key: "honest" },
  { href: "#faq", key: "faq" },
] as const;

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

/** A plain sticky bar; on small screens the sections open in a panel under it (never shifts the page). */
export function SiteHeader() {
  const t = useT().landing.header;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="pnl-header">
      <nav aria-label={t.mainNav} className="pnl-header__bar">
        <a href="#top" className="pnl-header__brand" aria-label={t.backToTop}>
          <LunadMark size={32} />
          <LunadWordmark className="pnl-header__word text-[1.375rem]" />
        </a>
        <div className="pnl-header__links">
          {SECTIONS.map((s) => (
            <a key={s.href} href={s.href}>
              {t.sections[s.key]}
            </a>
          ))}
        </div>
        <LanguageToggle className="pnl-header__lang pnl-header__lang--bar" />
        <Link href="/app" className="pnl-btn pnl-btn--primary pnl-header__cta">
          {t.openApp}
        </Link>
        <button
          type="button"
          className="pnl-header__menu"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? t.closeMenu : t.openMenu}
        >
          <svg width="20" height="20" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            {open ? <path d="M4 4l10 10M14 4L4 14" /> : <path d="M3 6h12M3 12h12" />}
          </svg>
        </button>
      </nav>
      <div id="mobile-menu" className="pnl-header__sheet" data-open={open} inert={!open}>
        <LanguageToggle className="pnl-header__lang pnl-header__lang--sheet" />
        {SECTIONS.map((s) => (
          <a key={s.href} href={s.href} onClick={() => setOpen(false)}>
            {t.sections[s.key]}
            <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M1 1l6 6-6 6" />
            </svg>
          </a>
        ))}
      </div>
    </header>
  );
}
