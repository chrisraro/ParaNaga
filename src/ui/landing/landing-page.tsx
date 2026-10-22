"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { attributionParts, currentTileConfig } from "@/client/map/tile-config";
import { useT } from "@/i18n/provider";
import { RouteNMark, Wordmark } from "@/ui/brand/route-n-mark";
import { DeviceFrame, Shot } from "@/ui/landing/device-frame";
import { HERO_LINES } from "@/ui/landing/hero-lines";
import { ROUTES, SHOT_H, SHOT_W, SHOWCASE_SCREENS } from "@/ui/landing/landing-content";
import { LandingMotion } from "@/ui/landing/landing-motion";
import { AppQr } from "@/ui/landing/qr-code";
import { SiteHeader } from "@/ui/landing/site-header";
import { ThemeCompare } from "@/ui/landing/theme-compare";
import "@/ui/landing/landing.css";

// Marketing landing page. Persuade, but only with what ships: every screen is a capture of the
// running app (public/landing, scripts/capture-landing.ts) and every claim comes from the app
// (landing-content.ts, held to the copy rules by tests/unit/landing-copy.test.ts).
// A client component so the copy follows the chosen language without a reload (the EN | FIL toggle in
// the header); it is still prerendered, in English, like the app shell (src/i18n/provider.tsx).

const d = (i: number) => ({ "--d": i }) as CSSProperties;

function Arrow() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 9h12M10 4l5 5-5 5" />
    </svg>
  );
}

function Tick() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function Icon({ d: path }: { d: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

const ICON = {
  jeep: "M5 17V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v10M5 12h14M7.5 20v-3M16.5 20v-3M8 15h.01M16 15h.01M3 10h2M19 10h2",
  trike: "M5.5 18.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 18.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 16h8M13 16V8h4l3 5M13 8H8L5.5 13.5",
  padyak: "M5.5 18.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 18.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM5.5 16 9 9h5l4.5 7M9 9 8 6H6M14 9l-2 7",
  walk: "M13 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM10 22l2-7 3 3v4M7 12l3-5 4 1 2 4M12 15l-2-4",
};

/** The real trip lines over the hero capture: a mask draws them in, in trip order. */
function RouteOverlay({ theme }: { theme: "light" | "dark" }) {
  const lines = HERO_LINES[theme];
  const id = `pnl-route-${theme}`;
  return (
    <svg className={`pnl-route pnl-route--${theme}`} viewBox="0 0 412 915" aria-hidden>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="412" height="915">
        {lines
          .filter((l) => l.kind === "casing")
          .map((l, i) => (
            <polyline
              key={i}
              className="pnl-route__mask"
              points={l.points}
              pathLength={1}
              fill="none"
              stroke="#fff"
              strokeWidth={l.width + 6}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ "--step": l.step } as CSSProperties}
            />
          ))}
      </mask>
      <g mask={`url(#${id})`} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {lines.map((l, i) => (
          <polyline key={i} points={l.points} stroke={l.color} strokeWidth={l.width} strokeDasharray={l.dash ?? undefined} />
        ))}
      </g>
    </svg>
  );
}

function Hero() {
  const t = useT().landing;
  return (
    <section id="top" aria-labelledby="hero-h" className="pnl-hero">
      {/* The LCP candidate: React hoists these into <head>, one per colour scheme. */}
      <link rel="preload" as="image" href="/landing/hero-light.webp" media="(prefers-color-scheme: light)" fetchPriority="high" />
      <link rel="preload" as="image" href="/landing/hero-dark.webp" media="(prefers-color-scheme: dark)" fetchPriority="high" />
      <span className="pnl-hero__glow" aria-hidden />
      <span className="pnl-hero__glow pnl-hero__glow--coral" aria-hidden />
      <div className="pnl-wrap">
        <h1 id="hero-h">
          <span className="pnl-in" style={d(0)}>{t.hero.titleA}</span>
          <span className="pnl-in" style={d(1)}>
            {t.hero.titleB} <em>Para!</em>
          </span>
        </h1>
        <div className="pnl-hero__row">
          <div className="pnl-hero__copy">
            <p className="pnl-lede pnl-in" style={d(2)}>{t.hero.lede}</p>
            <div className="pnl-hero__actions pnl-in" style={d(3)}>
              <Link href="/app" className="pnl-btn pnl-btn--bright">
                {t.header.openApp}
                <Arrow />
              </Link>
              <a href="#how" className="pnl-btn pnl-btn--ghost">
                {t.hero.seeHow}
              </a>
            </div>
            <p className="pnl-hero__note pnl-in" style={d(4)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7.5v5.5M12 16.5h.01" />
              </svg>
              {t.hero.note}
            </p>
          </div>
          <div className="pnl-stage">
            <div className="pnl-stage__back">
              <div className="pnl-stage__parallax-back">
                <DeviceFrame>
                  <Shot screen="options" decorative />
                </DeviceFrame>
              </div>
            </div>
            <div className="pnl-stage__front">
              <div className="pnl-stage__parallax-front">
                <div className="pnl-in" style={d(2)}>
                  <DeviceFrame>
                    <picture>
                      <source media="(prefers-color-scheme: dark)" srcSet="/landing/hero-dark.webp" />
                      <img src="/landing/hero-light.webp" width={SHOT_W} height={SHOT_H} alt={t.alt.hero} fetchPriority="high" decoding="async" />
                    </picture>
                    <RouteOverlay theme="light" />
                    <RouteOverlay theme="dark" />
                  </DeviceFrame>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function RouteBand() {
  const t = useT().landing;
  const list = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined}>
      {ROUTES.map((r, i) => (
        <li key={i}>
          <span className={r.letter ? "pnl-letter" : "pnl-letter pnl-letter--none"} aria-hidden>
            {r.letter ?? "·"}
          </span>
          {r.letter ? `${r.letter} ${r.title}` : r.title}
        </li>
      ))}
    </ul>
  );
  return (
    <section aria-label={t.routeBandLabel} className="pnl-band">
      <div className="pnl-band__track">
        {list(false)}
        {list(true)}
      </div>
    </section>
  );
}

function How() {
  const t = useT().landing.how;
  const steps = [t.pick, t.options, t.ride];
  return (
    <section id="how" aria-labelledby="how-h" className="pnl-section">
      <div className="pnl-wrap pnl-how">
        <div className="pnl-how__intro">
          <h2 id="how-h" className="pnl-h2 pnl-reveal">
            {t.heading}
          </h2>
          <p className="pnl-lede pnl-reveal" style={d(1)}>
            {t.lede}
          </p>
        </div>
        <div className="pnl-how__steps">
          <svg className="pnl-how__path" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden>
            <path className="pnl-how__line" d="M0 12 C 20 2, 30 22, 50 12 S 80 2, 100 12" pathLength={1} fill="none" stroke="var(--pnl-accent)" strokeWidth="2" strokeDasharray="1 1" vectorEffect="non-scaling-stroke" />
          </svg>
          <ol className="pnl-how__list">
          {steps.map((s, i) => (
            <li key={s.title} className="pnl-how__step pnl-reveal" style={d(i)}>
              <span className="pnl-how__dot" aria-hidden>
                {i + 1}
              </span>
              <h3>{s.title}</h3>
              <p className="pnl-body">{s.body}</p>
            </li>
          ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function Showcase() {
  const t = useT().landing.showcase;
  return (
    <section aria-labelledby="show-h" className="pnl-section" style={{ paddingTop: 0 }}>
      <div className="pnl-wrap pnl-show">
        <h2 id="show-h" className="pnl-h2 pnl-reveal">
          {t.heading}
        </h2>
        <div className="pnl-show__grid">
          <div className="pnl-show__pin">
            <DeviceFrame className="pnl-show__device" label={t.deviceLabel}>
              <div className="pnl-show__screens">
                {SHOWCASE_SCREENS.map((screen, i) => (
                  <div key={screen} className="pnl-show__screen" data-pnl-screen={i} data-on={i === 0}>
                    <Shot screen={screen} />
                  </div>
                ))}
              </div>
            </DeviceFrame>
            <div className="pnl-show__rail" aria-hidden>
              {SHOWCASE_SCREENS.map((screen, i) => (
                <span key={screen} data-pnl-rail={i} data-on={i === 0} />
              ))}
            </div>
          </div>
          <ol className="pnl-show__steps">
            {SHOWCASE_SCREENS.map((screen, i) => (
              <li key={screen} className="pnl-show__step" data-pnl-step={i}>
                <h3 className="pnl-reveal">{t[screen].title}</h3>
                <p className="pnl-body pnl-reveal" style={d(1)}>
                  {t[screen].body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function Ride() {
  const t = useT().landing.ride;
  return (
    <section id="ride" aria-labelledby="ride-h" className="pnl-section" style={{ paddingTop: 0 }}>
      <div className="pnl-wrap" style={{ display: "grid", gap: "clamp(32px, 4vw, 56px)" }}>
        <div style={{ display: "grid", gap: 20 }}>
          <h2 id="ride-h" className="pnl-h2 pnl-reveal">
            {t.heading}
          </h2>
          <p className="pnl-lede pnl-reveal" style={d(1)}>
            {t.lede}
          </p>
        </div>
        <div className="pnl-bento">
          <article className="pnl-card pnl-bento__jeep pnl-reveal">
            <span className="pnl-card__icon">
              <Icon d={ICON.jeep} />
            </span>
            <h3>{t.jeepney.title}</h3>
            <p className="pnl-body">{t.jeepney.body}</p>
            <ul className="pnl-routes" aria-label={t.routeNames}>
              {ROUTES.map((r, i) => (
                <li key={i}>
                  <span className={r.letter ? "pnl-letter" : "pnl-letter pnl-letter--none"} aria-hidden>
                    {r.letter ?? "·"}
                  </span>
                  {r.letter ? (
                    <span>
                      <span className="sr-only">{r.letter} </span>
                      {r.title}
                    </span>
                  ) : (
                    r.title
                  )}
                </li>
              ))}
            </ul>
          </article>
          <article className="pnl-card pnl-bento__trike pnl-reveal" style={d(1)}>
            <span className="pnl-card__icon">
              <Icon d={ICON.trike} />
            </span>
            <h3>{t.tricycle.title}</h3>
            <p className="pnl-body">{t.tricycle.body}</p>
            <div className="pnl-chips">
              <span className="pnl-chip pnl-chip--dashed">{t.tricycle.minFare}</span>
              <span className="pnl-chip pnl-chip--dashed">{t.tricycle.noTime}</span>
            </div>
          </article>
          <article className="pnl-card pnl-reveal" style={d(2)}>
            <span className="pnl-card__icon">
              <Icon d={ICON.padyak} />
            </span>
            <h3>{t.padyak.title}</h3>
            <p className="pnl-body">{t.padyak.body}</p>
          </article>
          <article className="pnl-card pnl-reveal" style={d(3)}>
            <span className="pnl-card__icon">
              <Icon d={ICON.walk} />
            </span>
            <h3>{t.walk.title}</h3>
            <p className="pnl-body">{t.walk.body}</p>
          </article>
          <article className="pnl-card pnl-bento__wide pnl-reveal">
            <div className="pnl-anywhere">
              <div style={{ display: "grid", gap: 12 }}>
                <h3>{t.anywhere.title}</h3>
                <p className="pnl-body">{t.anywhere.body}</p>
                <span className="pnl-chip pnl-chip--warn">{t.anywhere.chip}</span>
              </div>
              <svg viewBox="0 0 520 120" aria-hidden>
                <path d="M10 80 C 120 80, 150 30, 260 40 S 420 90, 510 50" fill="none" stroke="#ffffff" strokeWidth="14" strokeLinecap="round" />
                <path className="pnl-how__line" d="M10 80 C 120 80, 150 30, 260 40 S 420 90, 510 50" pathLength={1} fill="none" stroke="#b45309" strokeWidth="8" strokeLinecap="round" strokeDasharray="1 1" />
                <circle cx="10" cy="80" r="9" fill="#0b7a75" stroke="#fff" strokeWidth="4" />
                <circle cx="510" cy="50" r="9" fill="#c73a2f" stroke="#fff" strokeWidth="4" />
                <g fill="#ffffff" stroke="#0f1e3d" strokeWidth="3">
                  <circle cx="150" cy="52" r="7" />
                  <circle cx="330" cy="58" r="7" />
                </g>
              </svg>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

function Split({ device, children, flip = false, id, labelledBy }: { device: ReactNode; children: ReactNode; flip?: boolean; id?: string; labelledBy: string }) {
  return (
    <section id={id} aria-labelledby={labelledBy} className="pnl-section" style={{ paddingTop: 0 }}>
      <div className={`pnl-wrap pnl-split ${flip ? "pnl-split--flip" : ""}`}>
        <div className="pnl-split__device pnl-reveal">{device}</div>
        <div className="pnl-split__copy">{children}</div>
      </div>
    </section>
  );
}

function Far() {
  const t = useT().landing.far;
  return (
    <Split
      labelledBy="far-h"
      device={
        <DeviceFrame>
          <Shot screen="far" />
        </DeviceFrame>
      }
    >
      <h2 id="far-h" className="pnl-h2 pnl-reveal">
        {t.title}
      </h2>
      <div className="pnl-places pnl-reveal" style={d(1)}>
        <span>Cararayan</span>
        <span>San Isidro</span>
        <span>Pacol</span>
        <span>Carolina</span>
        <span>Panicuason</span>
      </div>
      <p className="pnl-lede pnl-reveal" style={d(1)}>
        {t.body}
      </p>
      <ul className="pnl-ticks">
        {Object.values(t.points).map((p, i) => (
          <li key={p} className="pnl-reveal" style={d(i + 2)}>
            <Tick />
            {p}
          </li>
        ))}
      </ul>
    </Split>
  );
}

function Offline() {
  const t = useT().landing.offline;
  return (
    <section aria-labelledby="offline-h" className="pnl-section" style={{ paddingTop: 0 }}>
      <div className="pnl-wrap pnl-offline">
        <div style={{ display: "grid", gap: 22 }}>
          <div className="pnl-signal pnl-reveal" aria-hidden>
            <span />
            <span />
            <span />
            <span />
          </div>
          <h2 id="offline-h" className="pnl-h2 pnl-reveal">
            {t.title}
          </h2>
          <p className="pnl-lede pnl-reveal" style={d(1)}>
            {t.body}
          </p>
        </div>
        <div className="pnl-install">
          {[t.android, t.iphone].map((g, i) => (
            <div key={g.device} className="pnl-card pnl-reveal" style={d(i)}>
              <h3>{g.device}</h3>
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

function Themes() {
  const t = useT().landing.themes;
  return (
    <section aria-labelledby="themes-h" className="pnl-section" style={{ paddingTop: 0 }}>
      <div className="pnl-wrap pnl-compare">
        <div style={{ display: "grid", gap: 22 }}>
          <h2 id="themes-h" className="pnl-h2 pnl-reveal">
            {t.title}
          </h2>
          <p className="pnl-lede pnl-reveal" style={d(1)}>
            {t.body}
          </p>
        </div>
        <div style={{ display: "grid", gap: 20 }}>
          <ThemeCompare />
        </div>
      </div>
    </section>
  );
}

function Community() {
  const t = useT().landing.community;
  const items = [t.correction, t.driver, t.mine, t.myNaga, t.tips];
  return (
    <Split
      flip
      labelledBy="community-h"
      device={
        <DeviceFrame>
          <Shot screen="report" />
        </DeviceFrame>
      }
    >
      <h2 id="community-h" className="pnl-h2 pnl-reveal">
        {t.title}
      </h2>
      <ul className="pnl-list">
        {items.map((item, i) => (
          <li key={item.title} className="pnl-reveal" style={d(i % 3)}>
            <strong>{item.title}</strong>
            <span className="pnl-body">{item.body}</span>
          </li>
        ))}
      </ul>
    </Split>
  );
}

function Honesty() {
  const t = useT().landing.promise;
  const facts = [t.routes, t.provisional, t.fares, t.tracking];
  return (
    <section id="honest" aria-labelledby="honest-h" className="pnl-section pnl-promise">
      <div className="pnl-wrap">
        <h2 id="honest-h" className="pnl-h2 pnl-reveal">
          {t.title}
        </h2>
        <div className="pnl-facts">
          {facts.map((f, i) => (
            <div key={f.title} className="pnl-reveal" style={d(i % 2)}>
              <h3>{f.title}</h3>
              <p className="pnl-body">{f.body}</p>
            </div>
          ))}
        </div>
        <div className="pnl-privacy">
          <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
            <h3 className="pnl-reveal" style={{ fontSize: "1.6rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
              {t.privacyTitle}
            </h3>
            <p className="pnl-body pnl-reveal">
              {t.sourcesLead}{" "}
              <Link href="/app/help/sources" className="pnl-night-link">
                {t.sourcesLink}
              </Link>
              .
            </p>
          </div>
          <ul>
            {Object.values(t.privacy).map((p, i) => (
              <li key={p} className="pnl-reveal" style={d(i % 2)}>
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

function OnYourPhone() {
  const t = useT().landing.phone;
  const open = useT().landing.header.openApp;
  return (
    <section aria-labelledby="phone-h" className="pnl-section">
      <div className="pnl-wrap">
        <div className="pnl-phone pnl-reveal">
          <div className="pnl-phone__qr">
            <AppQr />
          </div>
          <div style={{ display: "grid", gap: 14, justifyItems: "start" }}>
            <h2 id="phone-h" className="pnl-h2" style={{ fontSize: "clamp(1.7rem, 3vw, 2.4rem)" }}>
              {t.title}
            </h2>
            <p className="pnl-body pnl-phone__desk">
              {t.desk}
            </p>
            <p className="pnl-body pnl-phone__touch">{t.touch}</p>
            <Link href="/app" className="pnl-btn pnl-btn--solid">
              {open}
              <Arrow />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  const t = useT().landing.faq;
  const items = [t.free, t.install, t.tracking, t.trust, t.phonesOnly, t.official];
  return (
    <section id="faq" aria-labelledby="faq-h" className="pnl-section" style={{ paddingTop: 0 }}>
      <div className="pnl-wrap pnl-faq">
        <h2 id="faq-h" className="pnl-h2">
          {t.heading}
        </h2>
        <div>
          {items.map(({ q, a }) => (
            <details key={q}>
              <summary>
                {q}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
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

function Closing() {
  const t = useT().landing;
  return (
    <section aria-labelledby="cta-h" style={{ paddingBottom: "var(--pnl-section)" }}>
      <div className="pnl-wrap">
        <div className="pnl-cta pnl-reveal">
          <span className="pnl-hero__glow" aria-hidden />
          <RouteNMark size={64} />
          <h2 id="cta-h">{t.closing.title}</h2>
          <p className="pnl-lede" style={{ color: "var(--pnl-night-ink2)" }}>
            {t.closing.lede}
          </p>
          <Link href="/app" className="pnl-btn pnl-btn--bright">
            {t.header.openApp}
            <Arrow />
          </Link>
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
        <div style={{ display: "grid", gap: 12 }}>
          <Wordmark className="text-[22px]" />
          <p>
            {t.footer.disclaimer}
          </p>
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
        <RouteBand />
        <How />
        <Showcase />
        <Ride />
        <Far />
        <Offline />
        <Themes />
        <Community />
        <Honesty />
        <OnYourPhone />
        <Faq />
        <Closing />
      </main>
      <Footer />
      <LandingMotion />
    </div>
  );
}
