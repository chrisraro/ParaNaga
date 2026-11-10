"use client";

import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";
import { attributionParts, currentTileConfig } from "@/client/map/tile-config";
import { useT } from "@/i18n/provider";
import { LunadMark, LunadWordmark } from "@/ui/brand/lunad-mark";
import { DeviceFrame, Shot } from "@/ui/landing/device-frame";
import { ROUTES, SHOWCASE_SCREENS, type Screen } from "@/ui/landing/landing-content";
import { LandingMotion } from "@/ui/landing/landing-motion";
import { AppQr } from "@/ui/landing/qr-code";
import { SiteHeader } from "@/ui/landing/site-header";
import { ThemeCompare } from "@/ui/landing/theme-compare";
import "@/ui/landing/landing.css";

// Marketing landing page. The category standard, played straight (PRODUCT.md): a calm, bright,
// product-led page. Every screen is a capture of the running app (public/landing, written by
// tests/e2e/landing-captures.spec.ts) and every claim comes from the app (landing-content.ts, held
// to the copy rules by tests/unit/landing-copy.test.ts).
// A client component so the copy follows the chosen language without a reload (the EN | FIL toggle in
// the header); it is still prerendered, in English, like the app shell (src/i18n/provider.tsx).

const d = (i: number) => ({ "--d": i }) as CSSProperties;

function Arrow() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 9h12M10 4l5 5-5 5" />
    </svg>
  );
}

function Tick() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function Icon({ d: path }: { d: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

const ICON = {
  jeep: "M5 17V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v10M5 12h14M7.5 20v-3M16.5 20v-3M8 15h.01M16 15h.01M3 10h2M19 10h2",
  trike: "M5.5 18.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 18.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 16h8M13 16V8h4l3 5M13 8H8L5.5 13.5",
  padyak: "M5.5 18.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 18.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM5.5 16 9 9h5l4.5 7M9 9 8 6H6M14 9l-2 7",
  walk: "M13 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM10 22l2-7 3 3v4M7 12l3-5 4 1 2 4M12 15l-2-4",
  para: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
};

/** A phone on the page's tinted stage. */
function Stage({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`pnl-stage ${className}`}>{children}</div>;
}

function Hero() {
  const t = useT().landing;
  return (
    <section id="top" aria-labelledby="hero-h" className="pnl-hero">
      {/* The LCP candidate: React hoists these into <head>, one per colour scheme. */}
      <link rel="preload" as="image" href="/landing/hero-light.webp" media="(prefers-color-scheme: light)" fetchPriority="high" />
      <link rel="preload" as="image" href="/landing/hero-dark.webp" media="(prefers-color-scheme: dark)" fetchPriority="high" />
      <div className="pnl-wrap pnl-hero__grid">
        <div className="pnl-hero__copy">
          <h1 id="hero-h">
            {t.hero.titleA} {t.hero.titleB} <em>Para!</em>
          </h1>
          <p className="pnl-lede">{t.hero.lede}</p>
          <div className="pnl-hero__actions">
            <Link href="/app" className="pnl-btn pnl-btn--primary">
              {t.header.openApp}
              <Arrow />
            </Link>
            <a href="#how" className="pnl-textlink">
              {t.hero.seeHow}
            </a>
          </div>
          <p className="pnl-hero__note">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7.5v5.5M12 16.5h.01" />
            </svg>
            {t.hero.note}
          </p>
        </div>
        <Stage className="pnl-hero__stage">
          <DeviceFrame>
            <Shot screen="hero" eager />
          </DeviceFrame>
        </Stage>
      </div>
    </section>
  );
}

/** Search a place, compare the ways to go, follow the trip: one crop of the real screen per step. */
function How() {
  const t = useT().landing.how;
  const steps: { copy: { title: string; body: string }; screen: Screen; at: string }[] = [
    { copy: t.pick, screen: "search", at: "0%" },
    { copy: t.options, screen: "options", at: "9%" },
    { copy: t.ride, screen: "detail", at: "100%" },
  ];
  return (
    <section id="how" aria-labelledby="how-h" className="pnl-section pnl-section--alt">
      <div className="pnl-wrap">
        <div className="pnl-intro">
          <h2 id="how-h" className="pnl-h2">
            {t.heading}
          </h2>
          <p className="pnl-lede">{t.lede}</p>
        </div>
        <ol className="pnl-how">
          {steps.map((s, i) => (
            <li key={s.screen}>
              <figure className="pnl-crop pnl-reveal" style={{ ...d(i), "--at": s.at } as CSSProperties}>
                <Shot screen={s.screen} />
              </figure>
              <div className="pnl-how__text">
                <span className="pnl-how__n" aria-hidden>
                  {i + 1}
                </span>
                <h3 className="pnl-h3">{s.copy.title}</h3>
                <p className="pnl-body">{s.copy.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** Six screens, one phone: the open item's capture sits beside the list (under it on a phone). */
function Showcase() {
  const t = useT().landing.showcase;
  const [open, setOpen] = useState<Screen>(SHOWCASE_SCREENS[0]);
  return (
    <section aria-labelledby="show-h" className="pnl-section">
      <div className="pnl-wrap pnl-show">
        <h2 id="show-h" className="pnl-h2">
          {t.heading}
        </h2>
        <ol className="pnl-show__list" aria-label={t.deviceLabel}>
          {SHOWCASE_SCREENS.map((screen) => {
            const on = open === screen;
            return (
              <li key={screen} className="pnl-show__item" data-on={on}>
                <h3>
                  <button type="button" aria-expanded={on} aria-controls={`show-${screen}`} onClick={() => setOpen(screen)}>
                    {t[screen].title}
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                      <path d="M8 3v10M3 8h10" />
                    </svg>
                  </button>
                </h3>
                <div id={`show-${screen}`} className="pnl-show__panel" hidden={!on}>
                  <p className="pnl-body">{t[screen].body}</p>
                  <DeviceFrame className="pnl-show__device">
                    <Shot screen={screen} />
                  </DeviceFrame>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function Ride() {
  const t = useT().landing;
  const r = t.ride;
  return (
    <section id="ride" aria-labelledby="ride-h" className="pnl-section pnl-section--alt">
      <div className="pnl-wrap">
        <div className="pnl-intro">
          <h2 id="ride-h" className="pnl-h2">
            {r.heading}
          </h2>
          <p className="pnl-lede">{r.lede}</p>
        </div>
        <div className="pnl-ride">
          <ul className="pnl-modes">
            <li>
              <span className="pnl-modes__icon">
                <Icon d={ICON.jeep} />
              </span>
              <div>
                <h3 className="pnl-h3">{r.jeepney.title}</h3>
                <p className="pnl-body">{r.jeepney.body}</p>
              </div>
            </li>
            <li>
              <span className="pnl-modes__icon">
                <Icon d={ICON.trike} />
              </span>
              <div>
                <h3 className="pnl-h3">{r.tricycle.title}</h3>
                <p className="pnl-body">{r.tricycle.body}</p>
                <p className="pnl-chips">
                  <span className="pnl-chip">{r.tricycle.minFare}</span>
                  <span className="pnl-chip pnl-chip--dashed">{r.tricycle.noTime}</span>
                </p>
              </div>
            </li>
            <li>
              <span className="pnl-modes__icon">
                <Icon d={ICON.padyak} />
              </span>
              <div>
                <h3 className="pnl-h3">{r.padyak.title}</h3>
                <p className="pnl-body">{r.padyak.body}</p>
              </div>
            </li>
            <li>
              <span className="pnl-modes__icon">
                <Icon d={ICON.walk} />
              </span>
              <div>
                <h3 className="pnl-h3">{r.walk.title}</h3>
                <p className="pnl-body">{r.walk.body}</p>
              </div>
            </li>
            <li>
              <span className="pnl-modes__icon">
                <Icon d={ICON.para} />
              </span>
              <div>
                <h3 className="pnl-h3">{r.anywhere.title}</h3>
                <p className="pnl-body">{r.anywhere.body}</p>
                <p className="pnl-chips">
                  <span className="pnl-chip pnl-chip--warn">{r.anywhere.chip}</span>
                </p>
              </div>
            </li>
          </ul>
          <div className="pnl-routes">
            <h3 id="routes-h" className="pnl-routes__title">
              {t.routeBandLabel}
            </h3>
            <ul aria-label={r.routeNames}>
              {ROUTES.map((route, i) => (
                <li key={i}>
                  <span className={route.letter ? "pnl-letter" : "pnl-letter pnl-letter--none"} aria-hidden>
                    {route.letter}
                  </span>
                  {route.letter ? (
                    <span>
                      <span className="sr-only">{route.letter} </span>
                      {route.title}
                    </span>
                  ) : (
                    route.title
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function Split({ media, children, flip = false, alt = false, labelledBy }: { media: ReactNode; children: ReactNode; flip?: boolean; alt?: boolean; labelledBy: string }) {
  return (
    <section aria-labelledby={labelledBy} className={`pnl-section ${alt ? "pnl-section--alt" : ""}`}>
      <div className={`pnl-wrap pnl-split ${flip ? "pnl-split--flip" : ""}`}>
        <div className="pnl-split__copy">{children}</div>
        <div className="pnl-split__media">{media}</div>
      </div>
    </section>
  );
}

function Far() {
  const t = useT().landing.far;
  return (
    <Split
      labelledBy="far-h"
      media={
        <figure className="pnl-crop pnl-crop--tall pnl-reveal">
          <Shot screen="far" />
        </figure>
      }
    >
      <h2 id="far-h" className="pnl-h2">
        {t.title}
      </h2>
      <p className="pnl-places">
        <span>Cararayan</span>
        <span>San Isidro</span>
        <span>Pacol</span>
        <span>Carolina</span>
        <span>Panicuason</span>
      </p>
      <p className="pnl-lede">{t.body}</p>
      <ul className="pnl-ticks">
        {Object.values(t.points).map((p) => (
          <li key={p}>
            <Tick />
            {p}
          </li>
        ))}
      </ul>
    </Split>
  );
}

function Community() {
  const t = useT().landing.community;
  const items = [t.correction, t.driver, t.mine, t.myNaga, t.tips];
  return (
    <Split
      flip
      labelledBy="community-h"
      media={
        <Stage className="pnl-reveal">
          <DeviceFrame>
            <Shot screen="report" />
          </DeviceFrame>
        </Stage>
      }
    >
      <h2 id="community-h" className="pnl-h2">
        {t.title}
      </h2>
      <ul className="pnl-list">
        {items.map((item) => (
          <li key={item.title}>
            <h3 className="pnl-h3">{item.title}</h3>
            <p className="pnl-body">{item.body}</p>
          </li>
        ))}
      </ul>
    </Split>
  );
}

function Themes() {
  const t = useT().landing.themes;
  return (
    <section aria-labelledby="themes-h" className="pnl-section pnl-section--alt">
      <div className="pnl-wrap pnl-split">
        <div className="pnl-split__copy">
          <h2 id="themes-h" className="pnl-h2">
            {t.title}
          </h2>
          <p className="pnl-lede">{t.body}</p>
        </div>
        <div className="pnl-split__media">
          <Stage>
            <ThemeCompare />
          </Stage>
        </div>
      </div>
    </section>
  );
}

function Offline() {
  const t = useT().landing.offline;
  return (
    <section aria-labelledby="offline-h" className="pnl-section">
      <div className="pnl-wrap pnl-offline">
        <div className="pnl-split__copy">
          <h2 id="offline-h" className="pnl-h2">
            {t.title}
          </h2>
          <p className="pnl-lede">{t.body}</p>
        </div>
        <div className="pnl-install">
          {[t.android, t.iphone].map((g) => (
            <div key={g.device}>
              <h3 className="pnl-h3">{g.device}</h3>
              <ol>
                {Object.values(g.steps).map((s) => (
                  <li key={s} className="pnl-body">
                    {s}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Honesty() {
  const t = useT().landing.promise;
  const facts = [t.routes, t.provisional, t.fares, t.tracking];
  return (
    <section id="honest" aria-labelledby="honest-h" className="pnl-section pnl-section--tint">
      <div className="pnl-wrap">
        <h2 id="honest-h" className="pnl-h2">
          {t.title}
        </h2>
        <ul className="pnl-facts">
          {facts.map((f) => (
            <li key={f.title}>
              <h3 className="pnl-h3">{f.title}</h3>
              <p className="pnl-body">{f.body}</p>
            </li>
          ))}
        </ul>
        <div className="pnl-privacy">
          <div>
            <h3 className="pnl-privacy__title">{t.privacyTitle}</h3>
            <p className="pnl-body">
              {t.sourcesLead}{" "}
              <Link href="/app/help/sources">{t.sourcesLink}</Link>.
            </p>
          </div>
          <ul className="pnl-ticks">
            {Object.values(t.privacy).map((p) => (
              <li key={p}>
                <Tick />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  const t = useT().landing.faq;
  const items = [t.free, t.install, t.tracking, t.trust, t.phonesOnly, t.official];
  return (
    <section id="faq" aria-labelledby="faq-h" className="pnl-section">
      <div className="pnl-wrap pnl-faq">
        <h2 id="faq-h" className="pnl-h2">
          {t.heading}
        </h2>
        <div>
          {items.map(({ q, a }) => (
            <details key={q}>
              <summary>
                {q}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M8 3v10M3 8h10" />
                </svg>
              </summary>
              <p className="pnl-body">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The same action as the hero, with the way onto a phone: a QR on computers, the install hint on touch. */
function Closing() {
  const t = useT().landing;
  return (
    <section aria-labelledby="cta-h" className="pnl-section pnl-section--close">
      <div className="pnl-wrap">
        <div className="pnl-cta">
          <div className="pnl-cta__copy">
            <LunadMark size={56} tone="bright" />
            <h2 id="cta-h" className="pnl-h2">
              {t.closing.title}
            </h2>
            <p className="pnl-lede">{t.closing.lede}</p>
            <Link href="/app" className="pnl-btn pnl-btn--onbrand">
              {t.header.openApp}
              <Arrow />
            </Link>
          </div>
          <div className="pnl-phone">
            <div className="pnl-phone__qr">
              <AppQr />
            </div>
            <div>
              <h3 className="pnl-h3">{t.phone.title}</h3>
              <p className="pnl-body pnl-phone__desk">{t.phone.desk}</p>
              <p className="pnl-body pnl-phone__touch">{t.phone.touch}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const t = useT().landing;
  const tiles = attributionParts(currentTileConfig().attribution);
  return (
    <footer className="pnl-footer">
      <div className="pnl-wrap pnl-footer__inner">
        <div className="pnl-footer__about">
          <span className="pnl-footer__brand">
            <LunadMark size={28} />
            <LunadWordmark className="text-xl" />
          </span>
          <p>{t.footer.disclaimer}</p>
          <p>
            {t.footer.captures} &copy; <a href="https://www.openstreetmap.org/copyright">{t.footer.osm}</a>
            {t.footer.mapInApp}{" "}
            {tiles.map((p, i) =>
              p.href ? (
                <a key={i} href={p.href}>
                  {p.text}
                </a>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
            .
          </p>
        </div>
        <nav aria-label={t.footer.label}>
          <Link href="/app">{t.header.openApp}</Link>
          <a href="#how">{t.header.sections.how}</a>
          <a href="#honest">{t.header.sections.honest}</a>
          <Link href="/app/help/sources">{t.footer.sources}</Link>
          <Link href="/app/help">{t.footer.help}</Link>
        </nav>
      </div>
    </footer>
  );
}

export function LandingPage() {
  return (
    <div className="pnl">
      <SiteHeader />
      <main>
        <Hero />
        <How />
        <Showcase />
        <Ride />
        <Far />
        <Community />
        <Themes />
        <Offline />
        <Honesty />
        <Faq />
        <Closing />
      </main>
      <Footer />
      <LandingMotion />
    </div>
  );
}
