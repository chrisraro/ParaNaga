import type { Metadata } from "next";
import { MorePage as MoreTab } from "@/ui/settings/more-screen";

export const metadata: Metadata = {
  title: "Settings",
  description: "Settings for ParaNaga on this phone.",
};

// The "More" tab (artboard Settings) over the mounted home map. Static shell: every value comes
// from this device (preferences, permission state) or /api/v1 in the browser. The frame and its
// title are in the screen file, where they read the UI language.
export default function MorePage() {
  return <MoreTab />;
}
