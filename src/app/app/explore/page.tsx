import type { Metadata } from "next";
import { PageFrame } from "@/ui/app-shell/page-frame";
import { RouteDirectory } from "@/ui/explore/route-directory";

export const metadata: Metadata = {
  title: "Explore",
  description: "What ParaNaga has on file for Naga City: the routes of the approved plan.",
};

// Tab page over the mounted home map (src/ui/app-shell/app-frame.tsx). Static shell; the route
// list is fetched in the browser from /api/v1/routes.
export default function ExplorePage() {
  return (
    <PageFrame title="Explore" testId="explore-page">
      <RouteDirectory />
    </PageFrame>
  );
}
