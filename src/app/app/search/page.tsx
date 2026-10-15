import "@/ui/detail/detail.css";

import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchScreen } from "@/ui/search/search-screen";

export const metadata: Metadata = {
  title: "Search",
  description: "Search Naga City places, mapped stops, routes, terminals and barangays. Searches run on this phone.",
};

// A panel over the mounted home map. Static shell: `?for=` is read in the browser
// (useSearchParams inside Suspense), and the index is fetched there too, so the query never
// reaches the server. The fallback is the bare panel background (the screen renders on hydration).
export default function SearchPage() {
  return (
    <Suspense fallback={<div className="pn-detail" aria-busy="true" />}>
      <SearchScreen />
    </Suspense>
  );
}
