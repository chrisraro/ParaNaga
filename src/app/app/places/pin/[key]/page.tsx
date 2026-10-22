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

// See src/app/app/places/osm/[type]/[id]/page.tsx: params read inside Suspense, place from the cached index.
export default function PinPlacePage({ params }: PageProps<"/app/places/pin/[key]">) {
  return (
    <Suspense fallback={<DetailLoading what="place" />}>
      <PlaceFromParams params={params} />
    </Suspense>
  );
}

async function PlaceFromParams({ params }: { params: PageProps<"/app/places/pin/[key]">["params"] }) {
  const ref = parsePlaceRef("pin", await params);
  if (!ref) notFound();
  return <PlaceDetailScreen placeRef={ref} />;
}
