import type { Metadata } from "next";
import { LandingPage } from "@/ui/landing/landing-page";

// Both domains serve the site; this is the address to index. Not in the root layout: every page would
// inherit "/", and "./" needs the pathname, which Partial Prefetching refuses on /app/routes/[code].
export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function Home() {
  return <LandingPage />;
}
