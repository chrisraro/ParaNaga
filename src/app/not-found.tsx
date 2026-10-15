import type { Metadata } from "next";
import Link from "next/link";
import { RouteNMark } from "@/ui/brand/route-n-mark";

// Branded 404 for unknown URLs (and notFound() outside /app, which has its own panel).
// Next adds <meta name="robots" content="noindex"> to not-found responses.
export const metadata: Metadata = {
  title: "Page not found",
  description: "There is nothing at this link on ParaNaga.",
};

export default function NotFound() {
  return (
    <main
      className="flex min-h-dvh flex-col items-center justify-center gap-5 px-4 py-16 text-center text-white"
      style={{ background: "radial-gradient(900px 500px at 15% 0%, #1d3870 0%, rgba(29,56,112,0) 60%), #0f1e3d" }}
    >
      <RouteNMark size={64} />
      <h1 className="text-[clamp(32px,6vw,52px)] font-extrabold leading-[1.04] tracking-[-0.04em]">Wrong stop.</h1>
      <p className="max-w-[440px] text-lg leading-relaxed text-white/80">
        There is nothing at this link. It may have moved, or the address may have a typo.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/app"
          className="inline-flex h-12 items-center rounded-full bg-teal-bright px-5 font-bold text-on-teal-bright transition-transform active:scale-[0.97]"
        >
          Open the map
        </Link>
        <Link
          href="/"
          className="inline-flex h-12 items-center rounded-full bg-white/10 px-5 font-semibold shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)] transition-transform active:scale-[0.97]"
        >
          ParaNaga home
        </Link>
      </div>
    </main>
  );
}
