import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/ui/app-shell/page-frame";
import { RouteDirectory } from "@/ui/explore/route-directory";

export const metadata: Metadata = {
  title: "Explore",
  description: "What ParaNaga has on file for Naga City: the routes of the approved plan.",
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

// Tab page over the mounted home map (src/ui/app-shell/app-frame.tsx). Static shell; the route
// list is fetched in the browser from /api/v1/routes. The round action opens Search (artboard).
export default function ExplorePage() {
  return (
    <PageFrame title="Explore" action={<SearchAction />} testId="explore-page">
      <RouteDirectory />
    </PageFrame>
  );
}
