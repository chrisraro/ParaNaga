import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { parseUuidParam } from "@/domain/api/schemas";
import { DetailLoading } from "@/ui/detail/detail-frame";
import { StopDetailScreen } from "@/ui/stops/stop-detail";

export const metadata: Metadata = {
  title: "Stop",
  description: "A mapped stop candidate in Naga City: its source pin and the provisional routes that list it.",
};

// Cache Components: the id is runtime data (no generateStaticParams), so it is read inside
// Suspense; the shell (frame, loading panel) is prerendered. Data comes from /api/v1 in the
// browser, like the rest of the app.
export default function StopPage({ params }: PageProps<"/app/stops/[id]">) {
  return (
    <Suspense fallback={<DetailLoading title="Stop" />}>
      <StopFromParams params={params} />
    </Suspense>
  );
}

async function StopFromParams({ params }: { params: PageProps<"/app/stops/[id]">["params"] }) {
  const id = parseUuidParam((await params).id, "id");
  if (!id.ok) notFound();
  return <StopDetailScreen id={id.value} />;
}
