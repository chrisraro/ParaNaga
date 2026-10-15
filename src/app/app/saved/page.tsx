import type { Metadata } from "next";
import { PageFrame } from "@/ui/app-shell/page-frame";
import { Note } from "@/ui/kit/note";

export const metadata: Metadata = {
  title: "Saved",
  description: "Trips and places saved on this phone.",
};

// Tab page over the mounted home map. Saved trips and places live on the device (decision D3);
// nothing can be saved yet, so the page says so.
export default function SavedPage() {
  return (
    <PageFrame title="Saved" testId="saved-page">
      <Note testId="saved-empty">Nothing saved on this phone yet.</Note>
    </PageFrame>
  );
}
