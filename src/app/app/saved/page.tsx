import type { Metadata } from "next";
import { SavedPage as SavedTab } from "@/ui/saved/saved-screen";

export const metadata: Metadata = {
  title: "Saved",
  description: "Trips and places saved on this phone.",
};

// Tab page over the mounted home map. Saved trips, places and history live on this phone
// (IndexedDB, decision D3) and are read in the browser; the section comes from ?tab= (inside
// Suspense, so the shell stays static). The frame and its title are in the screen file, where
// they read the UI language.
export default function SavedPage() {
  return <SavedTab />;
}
