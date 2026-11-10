import type { Metadata } from "next";
import Link from "next/link";
import { LunadMark } from "@/ui/brand/lunad-mark";

// Branded 404 for unknown URLs (and notFound() outside /app, which has its own panel).
// Next adds <meta name="robots" content="noindex"> to not-found responses.
export const metadata: Metadata = {
  title: "Page not found",
  description: "There is nothing at this link on Lunad.",
};

export default function NotFound() {
  return (
    // The app's own surface (canvas, ink, the green primary pill), in light and dark: one clear
    // action, with the way home as a quiet text link under it. --pn-accent sets the focus ring.
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas px-4 py-16 text-center text-ink [--pn-accent:var(--color-brand)] dark:bg-night dark:text-night-ink dark:[--pn-accent:var(--color-brand-bright)]">
      <span className="mb-3 dark:hidden">
        <LunadMark size={56} />
      </span>
      <span className="mb-3 hidden dark:block">
        <LunadMark size={56} tone="bright" />
      </span>
      <h1 className="text-balance text-2xl font-bold leading-[1.2] tracking-[-0.015em]">Wrong stop.</h1>
      <p className="max-w-[34em] text-pretty text-[17px] leading-normal text-ink-2 dark:text-night-ink-2">
        There is nothing at this link. It may have moved, or the address may have a typo.
      </p>
      <div className="mt-4 flex w-full max-w-[320px] flex-col items-center gap-1">
        <Link
          href="/app"
          className="inline-flex min-h-[50px] w-full items-center justify-center rounded-full bg-brand px-6 text-[17px] font-semibold text-on-brand transition-transform active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 dark:bg-brand-bright dark:text-on-brand-bright"
        >
          Open the map
        </Link>
        <Link
          href="/"
          className="inline-flex min-h-12 items-center justify-center px-4 text-[15px] font-semibold text-brand dark:text-brand-bright"
        >
          Lunad home
        </Link>
      </div>
    </main>
  );
}
