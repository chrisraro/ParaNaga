import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { parsePlaceRef } from "@/domain/places/place-detail";
import { DetailLoading } from "@/ui/detail/detail-frame";
import { PlaceDetailScreen } from "@/ui/places/place-detail";

export const metadata: Metadata = {
  title: "Place",
  description: "A place in Naga City from the published data: where it is (when known), what is not yet mapped, and its source.",
};

// Cache Components: the params are runtime data (no generateStaticParams), so they are read
// inside Suspense; the shell (frame, loading panel) is prerendered. A malformed link is a 404
// here; a well-formed one that the published search index does not list gets the same panel from
// the client (the place is read from the cached index in the browser, like Search).
export default function OsmPlacePage({ params }: PageProps<"/app/places/osm/[type]/[id]">) {
  return (
    <Suspense fallback={<DetailLoading title="Place" />}>
      <PlaceFromParams params={params} />
    </Suspense>
  );
}

async function PlaceFromParams({ params }: { params: PageProps<"/app/places/osm/[type]/[id]">["params"] }) {
  const ref = parsePlaceRef("osm", await params);
  if (!ref) notFound();
  return <PlaceDetailScreen placeRef={ref} />;
}
