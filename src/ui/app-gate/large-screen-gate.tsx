"use client";

import Link from "next/link";
import { useState } from "react";
import { AppIconTile, Wordmark } from "@/ui/brand/route-n-mark";
import { DeviceFrame, Shot } from "@/ui/landing/device-frame";
import { QrCode, useAppUrl } from "@/ui/landing/qr-code";
import "@/ui/landing/landing.css";

// Shown instead of the app when /app opens on a screen wider than a phone or small
// tablet (design canvas: W2 · Open on your phone). The QR encodes this page's own URL,
// so whoever scans it lands on /app on their phone. The phone shows a real capture of the app's
// home screen (public/landing, scripts/capture-landing.ts).

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
    <div
      className="flex min-h-dvh flex-col text-white"
      style={{ background: "radial-gradient(900px 500px at 15% 0%, #1d3870 0%, rgba(29,56,112,0) 60%), radial-gradient(700px 500px at 100% 100%, rgba(43,181,174,0.18), rgba(43,181,174,0) 60%), #0f1e3d" }}
    >
      <header className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-4 px-4 py-5 md:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <AppIconTile size={30} />
          <Wordmark className="text-xl" />
        </Link>
        <Link href="/" className="flex min-h-11 items-center text-sm text-white/80 hover:text-white">Back to the website</Link>
      </header>

      <main className="mx-auto flex w-full max-w-[1180px] flex-1 flex-wrap items-center justify-center gap-[clamp(32px,6vw,88px)] px-4 pb-14 pt-6 md:px-8 md:pt-14">
        <div className="w-[280px] shrink-0 animate-rise">
          <DeviceFrame>
            <Shot screen="home" eager />
          </DeviceFrame>
        </div>

        <section aria-labelledby="gate-h" className="flex min-w-0 max-w-[540px] flex-[1_1_420px] flex-col gap-5">
          <span className="inline-flex h-8 animate-rise items-center gap-2 self-start rounded-full bg-white/10 px-3.5 text-[13px] font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
            Large screen detected
          </span>
          <h1 id="gate-h" className="animate-rise text-[clamp(36px,4.6vw,56px)] font-extrabold leading-[1.02] tracking-[-0.04em] [animation-delay:0.1s]">ParaNaga rides in your pocket.</h1>
          <p className="animate-rise text-lg leading-relaxed text-white/80 [animation-delay:0.1s]">
            The app guides you on the street with your location, the map and one-hand controls, so it only opens on phones and small tablets. Scan the code to continue on your phone.
          </p>

          <div className="flex animate-rise flex-wrap items-center gap-5 rounded-3xl bg-white/[0.06] p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] [animation-delay:0.2s]">
            <div className="relative size-[196px] shrink-0 overflow-hidden rounded-[18px] bg-white p-3.5">
              <QrCode value={appUrl} />
              <span aria-hidden className="absolute inset-x-2.5 top-2.5 h-0.5 animate-scan rounded bg-[linear-gradient(90deg,rgba(43,181,174,0),#2bb5ae,rgba(43,181,174,0))]" />
            </div>
            <ol className="flex flex-[1_1_200px] flex-col gap-3 text-[15px] leading-snug text-white/85">
              {["Open your phone's camera", "Point it at the code and tap the link", "Add to Home Screen for one-tap access"].map((t, i) => (
                <li key={t} className="flex gap-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-teal-bright text-[13px] font-bold text-on-teal-bright">{i + 1}</span>
                  {t}
                </li>
              ))}
            </ol>
          </div>

          <div className="flex animate-rise flex-wrap items-center gap-3 [animation-delay:0.2s]">
            <label htmlFor="app-link" className="sr-only">App link</label>
            <input
              id="app-link"
              readOnly
              value={appUrl}
              className="h-12 min-w-0 flex-[1_1_220px] rounded-full bg-white/[0.08] px-4.5 font-mono text-sm text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)] outline-none"
            />
            <button
              type="button"
              onClick={copy}
              className={`inline-flex h-12 items-center gap-2 rounded-full px-5 text-[15px] font-bold transition-[transform,background-color] active:scale-[0.97] ${copied ? "bg-teal-bright/20 text-[#5fd4cd]" : "bg-teal-bright text-on-teal-bright"}`}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            <span role="status" className="sr-only">{copied ? "Link copied" : ""}</span>
          </div>

          <p className="flex items-start gap-2.5 text-sm leading-normal text-white/60">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="mt-px shrink-0"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
            On a tablet or a narrow window? ParaNaga opens automatically once the screen is phone or small-tablet size.
          </p>
        </section>
      </main>
    </div>
  );
}
