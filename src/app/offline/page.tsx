import type { Metadata } from "next";
import { OfflineScreen } from "@/ui/pwa/offline-screen";

// The offline fallback (Task 12): a static page the service worker caches at install and serves
// for any page that cannot open without the network. Its content is read from the phone
// (IndexedDB) in the browser; nothing here is request-time.
export const metadata: Metadata = { title: "You're offline", robots: { index: false } };

export default function OfflinePage() {
  return <OfflineScreen />;
}
