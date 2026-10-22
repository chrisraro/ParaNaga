import type { Metadata } from "next";
import { ExplorePage as ExploreTab } from "@/ui/explore/explore-screen";

export const metadata: Metadata = {
  title: "Explore",
  description: "Places in Naga from OpenStreetMap, and how to get there, plus everything ParaNaga has on file.",
};

// Tab page over the mounted home map (src/ui/app-shell/app-frame.tsx). Static shell; the places
// and the directory come from the cached search index (and /api/v1/routes) in the browser. The
// round action opens Search (artboard). The frame, title and intro are in the screen file, where
// they read the UI language.
export default function ExplorePage() {
  return <ExploreTab />;
}
