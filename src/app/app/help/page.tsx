import type { Metadata } from "next";
import { Suspense } from "react";
import { PageFrame } from "@/ui/app-shell/page-frame";
import { HelpScreen } from "@/ui/help/help-screen";

export const metadata: Metadata = {
  title: "Help",
  description: "How ParaNaga plans trips, commuting safely, and where its data comes from.",
};

// Opened from More (Back returns there), over the mounted home map. The section comes from ?tab=
// (inside Suspense, so the shell stays static); the data revision row reads /api/v1 in the browser.
export default function HelpPage() {
  return (
    <PageFrame title="Help" back testId="help-page">
      <Suspense fallback={null}>
        <HelpScreen />
      </Suspense>
    </PageFrame>
  );
}
