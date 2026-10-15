import type { Metadata } from "next";
import { SourcesScreen } from "@/ui/help/sources-screen";

export const metadata: Metadata = {
  title: "Sources and dates",
  description: "Every source the published ParaNaga data cites, with its evidence type and the date it was checked.",
};

// Static shell; the register comes from GET /api/v1/sources in the browser.
export default function SourcesPage() {
  return <SourcesScreen />;
}
