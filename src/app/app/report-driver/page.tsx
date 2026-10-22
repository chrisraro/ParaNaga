import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { driverReportsEnabled } from "@/server/flags";
import { PageFrame } from "@/ui/app-shell/page-frame";
import { DriverReportWizard } from "@/ui/report-driver/driver-report-wizard";

export const metadata: Metadata = {
  title: "Report a driver",
  description: "Send ParaNaga a private report about a driver. It is never published and ParaNaga does not send it to Naga City.",
  referrer: "no-referrer",
};

// Static shell: the session, camera and submission all run in the browser. Reading the explainer
// works as a guest; sending needs an account (checked on step 1 and by the API).
export default function ReportDriverPage() {
  if (!driverReportsEnabled()) notFound(); // N2: hidden until a complaint reviewer exists; riders use MyNaga
  return (
    <PageFrame title="Report a driver" back testId="report-driver-page">
      <DriverReportWizard />
    </PageFrame>
  );
}
