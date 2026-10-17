import type { Metadata } from "next";
import { Suspense } from "react";
import { MyNagaScreen } from "@/ui/mynaga/mynaga-screen";
import { MyNagaRoute } from "@/ui/mynaga/mynaga-route";

export const metadata: Metadata = {
  title: "Report in MyNaga",
  description: "How to report a problem with a driver to the City of Naga in its MyNaga app. ParaNaga is not affiliated with MyNaga.",
  referrer: "no-referrer",
};

// Static shell (also cached offline). Without a report it is informational: nothing is prepared,
// copied, sent or recorded. With ?report=<id> the owner's handoff loads in the browser from a
// private endpoint (task B9). The prerendered fallback is the informational screen.
export default function MyNagaPage() {
  return (
    <Suspense fallback={<MyNagaScreen />}>
      <MyNagaRoute />
    </Suspense>
  );
}
