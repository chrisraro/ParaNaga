import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageFrame } from "@/ui/app-shell/page-frame";
import { ExploreScreen } from "@/ui/explore/explore-screen";

export const metadata: Metadata = {
  title: "Explore",
  description: "Places in Naga from OpenStreetMap, and how to get there, plus everything ParaNaga has on file.",
};

function SearchAction() {
  return (
    <Link href="/app/search" aria-label="Search" className="pn-detail__round" data-testid="explore-search">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
    </Link>
  );
}

// Tab page over the mounted home map (src/ui/app-shell/app-frame.tsx). Static shell; the places
// and the directory come from the cached search index (and /api/v1/routes) in the browser. The
// round action opens Search (artboard).
export default function ExplorePage() {
  return (
    <PageFrame
      title="Explore"
      action={<SearchAction />}
      header={<p className="pn-explore__intro">Places in Naga, and how to get there.</p>}
      testId="explore-page"
    >
      <Suspense fallback={null}>
        <ExploreScreen />
      </Suspense>
    </PageFrame>
  );
}
