import type { Metadata } from "next";
import { Suspense } from "react";
import { LocalizedPageFrame } from "@/ui/app-shell/localized-page-frame";
import { ReportWizard } from "@/ui/report/report-wizard";

export const metadata: Metadata = {
  title: "Report a correction",
  description: "Tell ParaNaga what is wrong with a stop, route, fare or trip.",
};

// Reading the wizard works as a guest; sending needs an account (checked on the last step and by
// the API). The entity comes from ?type=&id=&label= (inside Suspense, so the shell stays static).
export default function ReportPage() {
  return (
    <LocalizedPageFrame title="report" back testId="report-page">
      <Suspense fallback={null}>
        <ReportWizard />
      </Suspense>
    </LocalizedPageFrame>
  );
}
