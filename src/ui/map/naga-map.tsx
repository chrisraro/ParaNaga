"use client";

// Public entry for the Naga City map. Leaflet needs `window`, so the implementation is
// loaded client-only; `ssr: false` is only allowed from a Client Component like this one.

import dynamic from "next/dynamic";
import type { NagaMapProps } from "./types";

export type { NagaMapPins, NagaMapProps } from "./types";

function MapPlaceholder() {
  return <div className="pn-map-placeholder h-full w-full bg-[#f2efe9] dark:bg-[#1e2633]" aria-hidden="true" />;
}

const NagaMapLeaflet = dynamic(() => import("./naga-map-leaflet"), {
  ssr: false,
  loading: MapPlaceholder,
});

export function NagaMap(props: NagaMapProps) {
  return <NagaMapLeaflet {...props} />;
}
