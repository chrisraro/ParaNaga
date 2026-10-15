import type { Metadata } from "next";
import { PageFrame } from "@/ui/app-shell/page-frame";
import { MoreScreen } from "@/ui/settings/more-screen";

export const metadata: Metadata = {
  title: "Settings",
  description: "Settings for ParaNaga on this phone.",
};

// The "More" tab (artboard Settings) over the mounted home map. Static shell: every value comes
// from this device (preferences, permission state) or /api/v1 in the browser.
export default function MorePage() {
  return (
    <PageFrame title="Settings" testId="more-page">
      <MoreScreen />
    </PageFrame>
  );
}
