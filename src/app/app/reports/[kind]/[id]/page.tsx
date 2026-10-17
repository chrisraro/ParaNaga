import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { parseUuidParam } from "@/domain/api/schemas";
import { PageFrame } from "@/ui/app-shell/page-frame";
import { ReportDetailScreen } from "@/ui/reports/report-detail";

export const metadata: Metadata = {
  title: "Report",
  description: "One of your reports and where it stands.",
  referrer: "no-referrer",
};

// The id is runtime data, read inside Suspense; the report itself loads in the browser from a
// private endpoint (like the rest of the app). The kind is "complaint" or "correction".
export default function ReportPage({ params }: PageProps<"/app/reports/[kind]/[id]">) {
  return (
    <PageFrame title="Report" back testId="report-detail-page">
      <Suspense fallback={<p role="status">Loading…</p>}>
        <ReportFromParams params={params} />
      </Suspense>
    </PageFrame>
  );
}

async function ReportFromParams({ params }: { params: PageProps<"/app/reports/[kind]/[id]">["params"] }) {
  const { kind, id } = await params;
  const uuid = parseUuidParam(id, "id");
  if (!uuid.ok || (kind !== "complaint" && kind !== "correction")) notFound();
  return <ReportDetailScreen kind={kind} id={uuid.value} />;
}
