import type { Metadata } from "next";
import { PageFrame } from "@/ui/app-shell/page-frame";
import { Note } from "@/ui/kit/note";

export const metadata: Metadata = {
  title: "Settings",
  description: "Settings for ParaNaga on this phone.",
};

// The "More" tab (artboard Settings) over the mounted home map. No settings exist yet, so the page
// has no controls.
export default function MorePage() {
  return (
    <PageFrame title="Settings" testId="more-page">
      <Note testId="more-note">Settings for this phone.</Note>
    </PageFrame>
  );
}
