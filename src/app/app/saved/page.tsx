import type { Metadata } from "next";
import { Suspense } from "react";
import { PageFrame } from "@/ui/app-shell/page-frame";
import { SavedScreen } from "@/ui/saved/saved-screen";

export const metadata: Metadata = {
  title: "Saved",
  description: "Trips and places saved on this phone.",
};

// Tab page over the mounted home map. Saved trips, places and history live on this phone
// (IndexedDB, decision D3) and are read in the browser; the section comes from ?tab= (inside
// Suspense, so the shell stays static).
export default function SavedPage() {
  return (
    <PageFrame title="Saved" testId="saved-page">
      <Suspense fallback={null}>
        <SavedScreen />
      </Suspense>
    </PageFrame>
  );
}
