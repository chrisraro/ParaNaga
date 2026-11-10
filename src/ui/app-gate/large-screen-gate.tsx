"use client";

import Link from "next/link";
import { useState } from "react";
import { LunadMark, LunadWordmark } from "@/ui/brand/lunad-mark";
import { DeviceFrame, Shot } from "@/ui/landing/device-frame";
import { QrCode, useAppUrl } from "@/ui/landing/qr-code";
import "@/ui/landing/landing.css";

// Shown instead of the app when /app opens on a screen wider than a phone or small
// tablet (design canvas: W2 · Open on your phone). The QR encodes this page's own URL,
// so whoever scans it lands on /app on their phone. The phone shows a real capture of the app's
// home screen (public/landing, tests/e2e/landing-captures.spec.ts).

export function LargeScreenGate() {
  const appUrl = useAppUrl();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopied(true);
    } catch {
      setCopied(false);
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
        <Link href="/" className="flex min-h-12 items-center text-[15px] font-semibold text-white/80 hover:text-white">Back to the website</Link>
      </header>

      <main className="mx-auto flex w-full max-w-[1180px] flex-1 flex-wrap items-center justify-center gap-[clamp(32px,6vw,88px)] px-4 pb-14 pt-6 md:px-8 md:pt-14">
        <div className="w-[280px] shrink-0">
          <DeviceFrame>
            <Shot screen="home" eager />
          </DeviceFrame>
        </div>

        <section aria-labelledby="gate-h" className="flex min-w-0 max-w-[540px] flex-[1_1_420px] flex-col gap-5">
          <span className="inline-flex items-center gap-2 self-start text-[15px] font-semibold text-white/80">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
            Large screen detected
          </span>
          <h1 id="gate-h" className="text-balance text-[32px] font-bold leading-[1.15] tracking-[-0.02em]">Lunad rides in your pocket.</h1>
          <p className="max-w-[34em] text-[17px] leading-normal text-white/80">
            The app guides you on the street with your location, the map and one-hand controls, so it only opens on phones and small tablets. Scan the code to continue on your phone.
          </p>

          <div className="flex flex-wrap items-center gap-5 rounded-2xl bg-deep-raised p-5">
            <div className="size-[196px] shrink-0 overflow-hidden rounded-xl bg-white p-3.5">
              <QrCode value={appUrl} />
            </div>
            <ol className="flex flex-[1_1_200px] flex-col gap-3 text-[15px] leading-snug text-white/90">
              {["Open your phone's camera", "Point it at the code and tap the link", "Add to Home Screen for one-tap access"].map((t, i) => (
                <li key={t} className="flex gap-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-bright text-[13px] font-bold tabular-nums text-on-brand-bright">{i + 1}</span>
                  {t}
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="app-link" className="sr-only">App link</label>
            <input
              id="app-link"
              readOnly
              value={appUrl}
              className="h-12 min-w-0 flex-[1_1_220px] rounded-xl bg-deep-2 px-4 font-mono text-[15px] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.4)]"
            />
            <button
              type="button"
              onClick={copy}
              className={`inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-semibold transition-transform active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 ${copied ? "bg-brand-bright/20 text-brand-light" : "bg-brand-bright text-on-brand-bright"}`}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            <span role="status" className="sr-only">{copied ? "Link copied" : ""}</span>
          </div>

          <p className="flex items-start gap-2.5 text-[13px] leading-normal text-white/70">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="mt-px shrink-0"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
            On a tablet or a narrow window? Lunad opens automatically once the screen is phone or small-tablet size.
          </p>
        </section>
      </main>
    </div>
  );
}
