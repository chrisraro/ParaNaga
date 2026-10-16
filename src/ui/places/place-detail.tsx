"use client";

// Place detail (artboard PlaceDetail; Increment A, Task 6) for the four kinds of place on file:
// an OpenStreetMap place, a mapped-pin place, a barangay and a 2025 study stop label. Every
// place comes from the cached search index of the published revision (useSearchIndex), so a
// place URL reaches no new API. Honesty: only the first two kinds have a location and can be a
// trip start or destination; nothing invents an entrance, hours, photos or ratings. The artboard's
// "Report" link is not rendered (corrections open with Increment B). The two kinds with a location
// have "Save place" (Task 8): saved on this phone, never sent anywhere.

import "@/ui/kit/styles";
import "./places.css";

import Link from "next/link";
import { photoForPlace, photoForPinPlace } from "@/domain/media/photos";
import { ReferencePhoto } from "./reference-photo";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, type ReactNode } from "react";
import { useNetworkResource } from "@/client/network/use-network-resource";
import { useSearchIndex } from "@/client/search/use-search-index";
import { sourceListSchema, stopDetailSchema, type SearchIndex, type SearchOsmPlace, type SearchPinPlace, type StopPin } from "@/domain/api/schemas";
import { formatIsoDate, latestRetrievedOn } from "@/domain/network/present";
import { OSM_CATEGORY_LABEL, type OsmElementType } from "@/domain/places/osm-categories";
import {
  findPlace,
  nearestMappedStops,
  osmObjectUrl,
  osmSourceText,
  otherSpellings,
  pinPlaceEndpointLabel,
  pinPlaceMainPin,
  pinPlacePoint,
  searchHref,
  studyKindText,
  studyRouteText,
  type PlaceRef,
} from "@/domain/places/place-detail";
import type { EndpointWhich } from "@/domain/trip/endpoints";
import { formatDistance } from "@/domain/trip/present";
import { useAppFrame } from "@/ui/app-shell/app-frame-context";
import { DetailError, DetailLoading, DetailNotFound, DetailPanel, useFocusOnMount, useReturnToMap } from "@/ui/detail/detail-frame";
import { StatusBadge, type BadgeVariant } from "@/ui/kit/badge";
import { ListCell } from "@/ui/kit/list";
import { Note } from "@/ui/kit/note";
import { OsmAttribution } from "@/ui/kit/osm-attribution";
import { Segmented } from "@/ui/kit/segmented";
import { SavePlaceButton } from "@/ui/saved/save-place-button";
import { NagaMap } from "@/ui/map/naga-map";
import { StopStreetView } from "@/ui/street-view/stop-street-view";

const TITLE = "Place";
/** Street level: a mapped-pin group spans at most 60 m, so its pins all show. */
const PLACE_ZOOM = 17;
const NOT_SOURCED = "Hours, photos and ratings are not shown unless sourced.";

export function PlaceDetailScreen({ placeRef }: { placeRef: PlaceRef }) {
  const state = useSearchIndex();
  if (state.status === "loading") return <DetailLoading title={TITLE} />;
  if (state.status === "error") return <DetailError title={TITLE} offline={state.problem === "offline"} onRetry={state.retry} />;
  return <PlaceDetailView index={state.index} placeRef={placeRef} />;
}

export function PlaceDetailView({ index, placeRef }: { index: SearchIndex; placeRef: PlaceRef }) {
  const entry = findPlace(index, placeRef);
  if (!entry) return <DetailNotFound what="place" />;
  switch (entry.kind) {
    case "osm":
      return <OsmPlaceView index={index} place={entry.place} type={entry.type} id={entry.id} />;
    case "pin":
      return <PinPlaceView place={entry.place} />;
    case "barangay":
      return <BarangayView place={entry.place} />;
    case "study":
      return <StudyLabelView place={entry.place} />;
  }
}

// ------------------------------------------------------------------ shared pieces

function PlaceHead({ title, kind, badges }: { title: string; kind: string; badges: BadgeVariant[] }) {
  const heading = useFocusOnMount<HTMLHeadingElement>(true);
  return (
    <div className="pn-place__head">
      <h1 ref={heading} tabIndex={-1} className="pn-detail__title">
        {title}
      </h1>
      <p className="pn-place__kind" data-testid="place-kind">
        {kind}
      </p>
      <div className="pn-detail__row">
        {badges.map((b) => (
          <StatusBadge key={b} variant={b} testId={`place-badge-${b}`} />
        ))}
      </div>
    </div>
  );
}

const DIRECTIONS = [
  { value: "destination", label: "Directions to here" },
  { value: "start", label: "Directions from here" },
] as const;

function DirectionsChoice({ which, onChange }: { which: EndpointWhich; onChange: (w: EndpointWhich) => void }) {
  return <Segmented options={DIRECTIONS} value={which} onChange={onChange} label="Directions" testId="place-directions" />;
}

function ArrowIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function PrimaryAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="pn-btn pn-btn--primary pn-place__cta" onClick={onClick} data-testid="place-cta">
      <ArrowIcon />
      {children}
    </button>
  );
}

/** "Plan trip to/from {name}": that trip end becomes the point, then the map shows again. */
function PlanTrip({ name, point, label }: { name: string; point: { lat: number; lng: number }; label: string }) {
  const frame = useAppFrame();
  const returnToMap = useReturnToMap();
  const [which, setWhich] = useState<EndpointWhich>("destination");
  return (
    <>
      <DirectionsChoice which={which} onChange={setWhich} />
      <PrimaryAction
        onClick={() => {
          frame?.requestEndpoint(which, { point: { ...point }, label });
          returnToMap();
        }}
      >
        {which === "destination" ? `Plan trip to ${name}` : `Plan trip from ${name}`}
      </PrimaryAction>
    </>
  );
}

type Row = { key: string; label: string; value: ReactNode; sub?: ReactNode; testId?: string };

/** The artboard's grouped fact rows: a small label, the value, an optional muted line. */
function FactRows({ rows, label }: { rows: Row[]; label: string }) {
  return (
    <dl className="pn-place__facts" aria-label={label}>
      {rows.map((r) => (
        <div key={r.key} className="pn-place__fact" data-testid={r.testId}>
          <dt className="pn-place__fact-label">{r.label}</dt>
          <dd className="pn-place__fact-value">{r.value}</dd>
          {r.sub ? <dd className="pn-place__fact-sub">{r.sub}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

function CameraIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3" y="6" width="18" height="14" rx="3" />
      <circle cx="12" cy="13" r="3.5" />
      <path d="M9 6l1.5-2h3L15 6" />
    </svg>
  );
}

/** Photo row: text only (no Report link until corrections open). */
function PhotoPending() {
  return (
    <div className="pn-place__photo" data-testid="place-photo">
      <span className="pn-place__photo-icon">
        <CameraIcon />
      </span>
      <span className="pn-place__photo-text">
        <span className="pn-place__photo-title">Photo pending</span>
        <span className="pn-place__photo-sub">Photos open with community corrections.</span>
      </span>
    </div>
  );
}

function PlaceMap({ children }: { children: ReactNode }) {
  return (
    <div className="pn-place__map" data-testid="place-map">
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ OpenStreetMap place

function OsmPlaceView({ index, place, type, id }: { index: SearchIndex; place: SearchOsmPlace; type: OsmElementType; id: string }) {
  const point = useMemo(() => ({ lat: place.lat, lng: place.lng }), [place.lat, place.lng]);
  const uid = useId();
  const nearby = nearestMappedStops(index, point);
  const rows: Row[] = [
    {
      key: "entrance",
      label: "Entrance",
      value: "Not yet mapped",
      sub: "Trips end at the place's map point until an entrance is surveyed.",
      testId: "place-entrance",
    },
  ];
  if (place.aliases.length > 0) rows.push({ key: "aka", label: "Also known as", value: place.aliases.join(" · "), testId: "place-aka" });
  rows.push({
    key: "source",
    label: "Source",
    value: osmSourceText(place, type, id),
    sub: (
      <>
        <a className="pn-inline-link" href={osmObjectUrl(type, id)} target="_blank" rel="noopener noreferrer" data-testid="place-osm-link">
          View on OpenStreetMap
        </a>
        <span className="pn-place__fact-sub-line">{NOT_SOURCED}</span>
      </>
    ),
    testId: "place-source",
  });

  return (
    <DetailPanel title={TITLE} testId="place-detail">
      <PlaceMap>
        <NagaMap
          initialView={{ center: point, zoom: PLACE_ZOOM }}
          placeMarker={{ point, label: place.name }}
          label={`Map of ${place.name}`}
        />
      </PlaceMap>
      <main className="pn-detail__main pn-detail-in">
        <PlaceHead title={place.name} kind={`${OSM_CATEGORY_LABEL[place.category]} · from OpenStreetMap`} badges={["osm"]} />
        <PlanTrip name={place.name} point={point} label={place.name} />
        <Note testId="place-location-note">Location from OpenStreetMap — entrance not mapped.</Note>
        <SavePlaceButton label={place.name} point={point} source="osm" testId="place-save" />
        <FactRows rows={rows} label="About this place" />
        <StopStreetView what="place" lat={place.lat} lng={place.lng} name={place.name} />
        <section className="pn-section" aria-labelledby={`${uid}-near`}>
          <h2 id={`${uid}-near`} className="pn-section__title">
            Nearest mapped stops
          </h2>
          <ul className="pn-group" data-testid="place-nearest-stops">
            {nearby.length === 0 ? (
              <li className="pn-cell pn-cell--empty">No mapped stop within 600 m.</li>
            ) : (
              nearby.map((s) => (
                <ListCell
                  key={s.stopId}
                  href={`/app/stops/${s.stopId}`}
                  title={s.label}
                  sub={[formatDistance(s.meters), s.code, s.layer].filter(Boolean).join(" · ")}
                  subTone="gold"
                />
              ))
            )}
          </ul>
          {nearby.length > 0 ? <Note>Straight-line distance to unverified mapped pins.</Note> : null}
        </section>
        {photoForPlace(place.key) ? <ReferencePhoto photo={photoForPlace(place.key)!} /> : <PhotoPending />}
        <OsmAttribution testId="place-osm-attribution" />
      </main>
    </DetailPanel>
  );
}

// ------------------------------------------------------------------ mapped-pin place

// StopsLayer only reads whether `routeCodes` is empty (the ring's filled centre); the index says
// which pins a route order lists, not which route.
const ON_A_ROUTE_ORDER = ["on a provisional route order"];

function pinsForMap(place: SearchPinPlace): StopPin[] {
  return place.pins.map((p) => ({
    id: p.stopId,
    name: place.label,
    lat: p.lat,
    lng: p.lng,
    status: "candidate",
    navigationApproved: false,
    source: { layer: p.layer, code: p.code, label: place.label },
    routeCodes: p.onRoute ? ON_A_ROUTE_ORDER : [],
  }));
}

/** "Public My Maps snapshot · retrieved 15 Oct 2026", dated from the main pin's source record. */
function useMyMapsSourceText(stopId: string): string {
  const resource = useNetworkResource(`/api/v1/stops/${encodeURIComponent(stopId)}`, stopDetailSchema);
  if (resource.status === "loading") return "Public My Maps snapshot";
  if (resource.status !== "ready") return "Public My Maps snapshot · retrieval date not loaded";
  const date = formatIsoDate(latestRetrievedOn(resource.data.sourceRecords));
  return `Public My Maps snapshot · ${date ? `retrieved ${date}` : "retrieval date not recorded"}`;
}

function PinPlaceView({ place }: { place: SearchPinPlace }) {
  const router = useRouter();
  const uid = useId();
  const point = useMemo(() => pinPlacePoint(place), [place]);
  const sourceText = useMyMapsSourceText(pinPlaceMainPin(place).stopId);
  const mapPins = useMemo(() => pinsForMap(place), [place]);
  const spellings = otherSpellings(place);
  const rows: Row[] = [
    { key: "entrance", label: "Entrance", value: "Not yet mapped", sub: "Trips end at the pin until an entrance is surveyed.", testId: "place-entrance" },
  ];
  if (spellings.length > 0) rows.push({ key: "aka", label: "Also known as", value: spellings.join(" · "), testId: "place-aka" });
  rows.push({ key: "source", label: "Source", value: sourceText, sub: NOT_SOURCED, testId: "place-source" });
  const n = place.pins.length;

  return (
    <DetailPanel title={TITLE} testId="place-detail">
      <PlaceMap>
        <NagaMap
          initialView={{ center: point, zoom: PLACE_ZOOM }}
          stopPins={mapPins}
          onStopSelect={(stopId) => router.push(`/app/stops/${stopId}`)}
          label={`Map of the pins named ${place.label}`}
        />
      </PlaceMap>
      <main className="pn-detail__main pn-detail-in">
        <PlaceHead title={place.label} kind={`Mapped stop · ${n === 1 ? "1 pin" : `${n} pins`}`} badges={["candidate"]} />
        <PlanTrip name={place.label} point={point} label={pinPlaceEndpointLabel(place.label)} />
        <Note testId="place-location-note">Trips use unverified mapped pins.</Note>
        <SavePlaceButton label={place.label} point={point} source="pin" testId="place-save" />
        <section className="pn-section" aria-labelledby={`${uid}-pins`}>
          <h2 id={`${uid}-pins`} className="pn-section__title">
            Pins with this name
          </h2>
          <ul className="pn-group" data-testid="place-pins">
            {place.pins.map((p) => (
              <ListCell
                key={p.stopId}
                href={`/app/stops/${p.stopId}`}
                title={`${p.code ?? "No code"} · ${p.layer ?? "No layer"}`}
                sub={p.onRoute ? "Listed in a provisional stop order" : "Not in a route's stop order"}
                subTone="gold"
              />
            ))}
          </ul>
        </section>
        <FactRows rows={rows} label="About this place" />
        <StopStreetView what="place" lat={point.lat} lng={point.lng} name={place.label} />
        {photoForPinPlace(place.label, place.pins) ? <ReferencePhoto photo={photoForPinPlace(place.label, place.pins)!} stop /> : <PhotoPending />}
      </main>
    </DetailPanel>
  );
}

// ------------------------------------------------------------------ barangay

/** "{title} · checked {date}" from the sources register; the code alone until it loads. */
function useSourceText(code: string | null): string {
  const resource = useNetworkResource("/api/v1/sources", sourceListSchema);
  if (!code) return "Not recorded";
  if (resource.status !== "ready") return code;
  const source = resource.data.sources.find((s) => s.code === code);
  if (!source) return code;
  const date = formatIsoDate(source.checkedOn);
  return `${source.title} · ${date ? `checked ${date}` : "check date not recorded"}`;
}

function BarangayView({ place }: { place: SearchIndex["barangays"][number] }) {
  const frame = useAppFrame();
  const returnToMap = useReturnToMap();
  const [which, setWhich] = useState<EndpointWhich>("destination");
  const source = useSourceText(place.sourceCode);
  const rows: Row[] = [
    { key: "boundary", label: "Boundary", value: "Not on file", testId: "place-boundary" },
    { key: "stops", label: "Stops in this barangay", value: "Unknown until a boundary is mapped", testId: "place-stops" },
    { key: "source", label: "Source", value: source, testId: "place-source" },
  ];
  return (
    <DetailPanel title={TITLE} testId="place-detail">
      <main className="pn-detail__main pn-detail-in">
        <PlaceHead title={place.name} kind="Barangay" badges={["not-surveyed"]} />
        <DirectionsChoice which={which} onChange={setWhich} />
        <PrimaryAction
          onClick={() => {
            frame?.requestPick(which);
            returnToMap();
          }}
        >
          {`Choose a point in ${place.name} on the map`}
        </PrimaryAction>
        <Note testId="place-location-note">No location on file for this barangay: you place the pin yourself.</Note>
        <FactRows rows={rows} label="About this barangay" />
      </main>
    </DetailPanel>
  );
}

// ------------------------------------------------------------------ 2025 study label

function StudyLabelView({ place }: { place: SearchIndex["studyLabels"][number] }) {
  const rows: Row[] = [
    { key: "route", label: "Route", value: studyRouteText(place.routeCode, place.direction), testId: "place-route" },
    { key: "location", label: "Location", value: "Not mapped. This is a schematic label, not a curb.", testId: "place-location" },
    { key: "status", label: "Status", value: "Historical pilot label; current status unverified", testId: "place-status" },
    { key: "sources", label: "Sources", value: place.sourceCodes.length > 0 ? place.sourceCodes.join(", ") : "Not recorded", testId: "place-source" },
  ];
  return (
    <DetailPanel title={TITLE} testId="place-detail">
      <main className="pn-detail__main pn-detail-in">
        <PlaceHead title={place.label} kind={studyKindText(place.sourceContext)} badges={["documented"]} />
        <Note testId="place-location-note">No location on file, so trips can&apos;t start or end here.</Note>
        <Link className="pn-text-btn pn-place__link" href={searchHref(place.label)} data-testid="place-search-link">
          {`Search mapped stops for “${place.label}”`}
        </Link>
        <FactRows rows={rows} label="About this label" />
      </main>
    </DetailPanel>
  );
}
