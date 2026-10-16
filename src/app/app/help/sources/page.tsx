import type { Metadata } from "next";
import { SourcesScreen } from "@/ui/help/sources-screen";

export const metadata: Metadata = {
  title: "Sources and credits",
  description: "Where ParaNaga data, estimates and photos come from: every source the published data cites, the licences and the credits.",
};

// Static shell; the register comes from GET /api/v1/sources in the browser.
export default function SourcesPage() {
  return <SourcesScreen />;
}
