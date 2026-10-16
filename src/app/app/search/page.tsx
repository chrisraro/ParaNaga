import "@/ui/detail/detail.css";

import type { Metadata } from "next";
import { Suspense } from "react";
import { DetailPanel } from "@/ui/detail/detail-frame";
import { SearchScreen } from "@/ui/search/search-screen";

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
    <Suspense
      fallback={
        <DetailPanel title="Search" testId="search-fallback">
          <div className="pn-detail__state" role="status" aria-label="Loading search">
            <div className="pn-skeleton" style={{ width: "100%", height: 44 }} />
            <div className="pn-skeleton" style={{ width: "70%" }} />
          </div>
        </DetailPanel>
      }
    >
      <SearchScreen />
    </Suspense>
  );
}
