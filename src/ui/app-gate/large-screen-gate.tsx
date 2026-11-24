"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "@/i18n/provider";
import { deepLink } from "@/ui/app-gate/deep-link";
import { LunadMark, LunadWordmark } from "@/ui/brand/lunad-mark";
import { DeviceFrame, Shot } from "@/ui/landing/device-frame";
import { QrCode } from "@/ui/landing/qr-code";
import "@/ui/landing/landing.css";

// Shown instead of the app when /app opens on a screen wider than a phone or small
// tablet (design canvas: W2 · Open on your phone). The QR encodes this page's own URL,
// so whoever scans it lands on the same screen on their phone. The phone shows a real capture of the app's
// home screen (public/landing, tests/e2e/landing-captures.spec.ts).

const noop = () => () => {};

/** `focusHeading`: the gate just covered a running app, whose focused element turned inert. */
export function LargeScreenGate({ focusHeading = false }: { focusHeading?: boolean }) {
  const t = useT();
  const g = t.gate;
  usePathname(); // a client navigation re-renders, so the link below follows the URL
  const appUrl = useSyncExternalStore(noop, () => deepLink(window.location), () => "");
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const copied = copy === "copied";
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusHeading) heading.current?.focus();
  }, [focusHeading]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  return (
    // A plain deep-green page (no glow, no entrance choreography). --pn-accent makes the focus
    // ring the bright green, which shows on the dark surface.
    <div className="flex min-h-dvh flex-col bg-deep text-white [--pn-accent:var(--color-brand-bright)]">
      <header className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-4 px-4 py-5 md:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <LunadMark size={30} tone="bright" />
          <LunadWordmark className="text-xl" />
        </Link>
        <Link href="/" className="flex min-h-12 items-center text-[0.9375rem] font-semibold text-white/80 hover:text-white">{g.back}</Link>
      </header>

      <main className="mx-auto flex w-full max-w-[1180px] flex-1 flex-wrap items-center justify-center gap-[clamp(32px,6vw,88px)] px-4 pb-14 pt-6 md:px-8 md:pt-14">
        <div className="w-[280px] shrink-0">
          <DeviceFrame>
            <Shot screen="home" />
          </DeviceFrame>
        </div>

        <section aria-labelledby="gate-h" className="flex min-w-0 max-w-[540px] flex-[1_1_420px] flex-col gap-5">
          <span className="inline-flex items-center gap-2 self-start text-[0.9375rem] font-semibold text-white/80">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
            {g.detected}
          </span>
          <h1 id="gate-h" ref={heading} tabIndex={-1} className="outline-none text-balance text-[2rem] font-bold leading-[1.15] tracking-[-0.02em]">{g.title}</h1>
          <p className="max-w-[34em] text-[1.0625rem] leading-normal text-white/80">
            {g.body}
          </p>

          <div className="flex flex-wrap items-center gap-5 rounded-2xl bg-deep-raised p-5">
            <div className="size-[196px] shrink-0 overflow-hidden rounded-xl bg-white p-3.5">
              <QrCode value={appUrl} label={t.landing.phone.qrLabel} />
            </div>
            <ol className="flex flex-[1_1_200px] flex-col gap-3 text-[0.9375rem] leading-snug text-white/90">
              {Object.values(g.steps).map((step, i) => (
                <li key={step} className="flex gap-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-bright text-[0.8125rem] font-bold tabular-nums text-on-brand-bright">{i + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="app-link" className="sr-only">{g.linkLabel}</label>
            <input
              id="app-link"
              readOnly
              value={appUrl}
              className="h-12 min-w-0 flex-[1_1_220px] rounded-xl bg-deep-2 px-4 font-mono text-[0.9375rem] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.4)]"
            />
            <button
              type="button"
              onClick={copyLink}
              className={`inline-flex h-12 items-center gap-2 rounded-full px-6 text-[0.9375rem] font-semibold transition-transform active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 ${copied ? "bg-brand-bright/20 text-brand-light" : "bg-brand-bright text-on-brand-bright"}`}
            >
              {copied ? g.copied : g.copy}
            </button>
            <span role="status" className={copy === "failed" ? "text-[0.9375rem] text-white/90" : "sr-only"}>{copied ? g.copiedStatus : copy === "failed" ? g.copyFailed : ""}</span>
          </div>

          <p className="flex items-start gap-2.5 text-[0.8125rem] leading-normal text-white/70">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="mt-px shrink-0"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
            {g.note}
          </p>
        </section>
      </main>
    </div>
  );
}
