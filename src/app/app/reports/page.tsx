import type { Metadata } from "next";
import { driverReportsEnabled } from "@/server/flags";
import { LocalizedPageFrame } from "@/ui/app-shell/localized-page-frame";
import { ReportsScreen } from "@/ui/reports/reports-screen";

export const metadata: Metadata = {
  title: "My reports",
  description: "The corrections and driver reports you sent to ParaNaga, and where each one stands.",
  referrer: "no-referrer",
};

// Static shell: the session and the lists load in the browser from private endpoints.
export default function ReportsPage() {
  return (
    <LocalizedPageFrame title="reports" back testId="reports-page">
      <ReportsScreen driverReports={driverReportsEnabled()} />
    </LocalizedPageFrame>
  );
}
