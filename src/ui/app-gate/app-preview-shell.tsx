import Link from "next/link";
import { AppIconTile, Wordmark } from "@/ui/brand/route-n-mark";

// What phones see at /app until the commuter screens (S1 onward) ship. It is honest about
// the pre-launch state instead of showing sample trips as if they were real.
export function AppPreviewShell() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas pt-[env(safe-area-inset-top)] text-navy">
      <header className="flex items-center gap-2.5 px-4 pb-3 pt-4">
        <AppIconTile size={34} />
        <Wordmark className="text-[22px]" />
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 pb-[calc(24px+env(safe-area-inset-bottom))]">
        <h1 className="text-[34px] font-bold leading-tight tracking-tight">Where to?</h1>

        <label className="flex h-[52px] items-center gap-2.5 rounded-[14px] bg-fill px-3.5 text-ink-3">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
          </svg>
          <span className="sr-only">Search places, stops and routes</span>
          <input disabled placeholder="Landmark, stop or barangay" className="min-w-0 flex-1 bg-transparent text-[17px] outline-none" />
        </label>

        <section aria-labelledby="soon-h" className="flex flex-col gap-2 rounded-[22px] bg-white p-5 shadow-[0_1px_2px_rgba(15,30,61,0.06)]">
          <span className="inline-flex h-7 items-center gap-1.5 self-start rounded-full bg-[#fff4dc] px-2.5 text-[13px] font-semibold text-[#5a3f00]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            Opening soon
          </span>
          <h2 id="soon-h" className="text-xl font-bold tracking-tight">Trip planning opens with our first verified routes.</h2>
          <p className="text-[15px] leading-relaxed text-ink-2">
            We are checking stops and routes on the street before switching on directions. We would rather wait than send you to the wrong curb.
          </p>
        </section>

        <div className="mt-auto flex flex-col gap-3">
          <Link href="/" className="flex h-[52px] items-center justify-center rounded-full bg-teal text-[17px] font-semibold text-white transition-transform active:scale-[0.97]">
            Learn more about ParaNaga
          </Link>
          <p className="text-center text-[13px] text-ink-3">Tip: add this page to your Home Screen to be ready on launch.</p>
        </div>
      </main>
    </div>
  );
}
