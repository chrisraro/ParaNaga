import type { Metadata } from "next";
import { LocalizedPageFrame } from "@/ui/app-shell/localized-page-frame";
import { CommunityFeed } from "@/ui/community/community-feed";

export const metadata: Metadata = {
  title: "Community",
  description: "Tips and questions from Naga commuters. Written by commuters, not verified by ParaNaga.",
};

// Tab page over the mounted home map. Static shell: posts come from /api/v1/community in the browser.
export default function CommunityPage() {
  return (
    <LocalizedPageFrame title="community" testId="community-page">
      <CommunityFeed />
    </LocalizedPageFrame>
  );
}
