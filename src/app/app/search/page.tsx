import "@/ui/detail/detail.css";

import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchFallback, SearchScreen } from "@/ui/search/search-screen";

export const metadata: Metadata = {
  title: "Search",
  description: "Search Naga City places, mapped stops, routes, terminals and barangays. Searches run on this phone.",
};

// A panel over the mounted home map. Static shell: `?for=` is read in the browser
// (useSearchParams inside Suspense), and the index is fetched there too, so the query never
// reaches the server. The fallback is a panel with a header and a skeleton, never a bare
// background: on a slow phone it shows while the screen's code loads. Not DetailLoading: its
// offline text would be wrong here (Search works offline from the stored index).
export default function SearchPage() {
  return (
    <Suspense fallback={<SearchFallback />}>
      <SearchScreen />
    </Suspense>
  );
}
