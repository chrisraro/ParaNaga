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
import { useSearchIndex } from "@/client/search/use-search-index";
import { type SearchIndex, type SearchOsmPlace, type SearchPinPlace, type StopPin } from "@/domain/api/schemas";
import type { OsmElementType } from "@/domain/places/osm-categories";
import { useT } from "@/i18n/provider";
import {
  findPlace,
  nearestMappedStops,
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
import { Segmented } from "@/ui/kit/segmented";
import { SOURCES_HREF } from "@/ui/help/sources-href";
import { SavePlaceButton } from "@/ui/saved/save-place-button";
import { NagaMap } from "@/ui/map/naga-map";
import { StopStreetView } from "@/ui/street-view/stop-street-view";

/** The Sources link of a place with source codes (only well-formed S00 codes travel in the address). */
function codedSourcesHref(codes: readonly string[]): string {
  const valid = codes.filter((c) => /^S[0-9]{2}$/.test(c)).slice(0, 6);
  return valid.length > 0 ? `${SOURCES_HREF}?src=${valid.join(",")}` : SOURCES_HREF;
}
/** Street level: a mapped-pin group spans at most 60 m, so its pins all show. */
const PLACE_ZOOM = 17;

export function PlaceDetailScreen({ placeRef }: { placeRef: PlaceRef }) {
  const TITLE = useT().detail.place;
  const state = useSearchIndex();
  if (state.status === "loading") return <DetailLoading title={TITLE} />;
  if (state.status === "error") return <DetailError title={TITLE} offline={state.problem === "offline"} onRetry={state.retry} />;
  // Task 14: a restaurant or shop lives in the lazy places chunk; until it arrives (or when it
  // failed) a missing place is not "not found".
  if (state.morePlaces !== "ready" && placeRef.kind === "osm" && !findPlace(state.index, placeRef)) {
    return state.morePlaces === "loading" ? <DetailLoading title={TITLE} /> : <DetailError title={TITLE} offline={state.problem === "offline"} onRetry={state.retry} />;
  }
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

function DirectionsChoice({ which, onChange }: { which: EndpointWhich; onChange: (w: EndpointWhich) => void }) {
  const t = useT().places;
  const options = [
    { value: "destination", label: t.directionsTo },
    { value: "start", label: t.directionsFrom },
  ] as const;
  return <Segmented options={options} value={which} onChange={onChange} label={t.directions} testId="place-directions" />;
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
  const t = useT().places;
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
        {which === "destination" ? t.planTo(name) : t.planFrom(name)}
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
  const t = useT().places;
  return (
    <div className="pn-place__photo" data-testid="place-photo">
      <span className="pn-place__photo-icon">
        <CameraIcon />
      </span>
      <span className="pn-place__photo-text">
        <span className="pn-place__photo-title">{t.photoPending}</span>
        <span className="pn-place__photo-sub">{t.photoPendingSub}</span>
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
  const tt = useT();
  const t = tt.places;
  const point = useMemo(() => ({ lat: place.lat, lng: place.lng }), [place.lat, place.lng]);
  const uid = useId();
  const nearby = nearestMappedStops(index, point);
  const rows: Row[] = [
    {
      key: "entrance",
      label: t.entrance,
      value: t.entranceOsm,
      testId: "place-entrance",
    },
  ];
  if (place.aliases.length > 0) rows.push({ key: "aka", label: t.alsoKnownAs, value: place.aliases.join(" · "), testId: "place-aka" });

  return (
    <DetailPanel title={tt.detail.place} sources={`${SOURCES_HREF}?osm=${type}/${id}&v=${place.osmVersion}&s=${place.sourceCode}`} testId="place-detail">
      <PlaceMap>
        <NagaMap
          initialView={{ center: point, zoom: PLACE_ZOOM }}
          placeMarker={{ point, label: place.name }}
          label={t.mapOf(place.name)}
        />
      </PlaceMap>
      <main className="pn-detail__main pn-detail-in">
        <PlaceHead title={place.name} kind={t.category[place.category]} badges={["osm"]} />
        <PlanTrip name={place.name} point={point} label={place.name} />
        <SavePlaceButton label={place.name} point={point} source="osm" testId="place-save" />
        <FactRows rows={rows} label={t.aboutPlace} />
        <StopStreetView what="place" lat={place.lat} lng={place.lng} name={place.name} />
        <section className="pn-section" aria-labelledby={`${uid}-near`}>
          <h2 id={`${uid}-near`} className="pn-section__title">
            {t.nearestStops}
          </h2>
          <ul className="pn-group" data-testid="place-nearest-stops">
            {nearby.length === 0 ? (
              <li className="pn-cell pn-cell--empty">{t.noStopsNear}</li>
            ) : (
              nearby.map((s) => (
                <ListCell
                  key={s.stopId}
                  href={`/app/stops/${s.stopId}`}
                  title={s.label}
                  sub={[formatDistance(s.meters, tt.geo), s.code].filter(Boolean).join(" · ")}
                  subTone="gold"
                />
              ))
            )}
          </ul>
          {nearby.length > 0 ? <Note>{t.straightLine}</Note> : null}
        </section>
        {photoForPlace(place.key) ? <ReferencePhoto photo={photoForPlace(place.key)!} /> : <PhotoPending />}
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

function PinPlaceView({ place }: { place: SearchPinPlace }) {
  const tt = useT();
  const t = tt.places;
  const router = useRouter();
  const uid = useId();
  const point = useMemo(() => pinPlacePoint(place), [place]);
  const mapPins = useMemo(() => pinsForMap(place), [place]);
  const spellings = otherSpellings(place);
  const rows: Row[] = [
    { key: "entrance", label: t.entrance, value: t.entrancePin, testId: "place-entrance" },
  ];
  if (spellings.length > 0) rows.push({ key: "aka", label: t.alsoKnownAs, value: spellings.join(" · "), testId: "place-aka" });
  const n = place.pins.length;

  return (
    <DetailPanel title={tt.detail.place} sources={`${SOURCES_HREF}?stop=${pinPlaceMainPin(place).stopId}`} testId="place-detail">
      <PlaceMap>
        <NagaMap
          initialView={{ center: point, zoom: PLACE_ZOOM }}
          stopPins={mapPins}
          onStopSelect={(stopId) => router.push(`/app/stops/${stopId}`)}
          label={t.mapOfPins(place.label)}
        />
      </PlaceMap>
      <main className="pn-detail__main pn-detail-in">
        <PlaceHead title={place.label} kind={t.mappedStopPins(n)} badges={["candidate"]} />
        <PlanTrip name={place.label} point={point} label={pinPlaceEndpointLabel(place.label)} />
        <Note testId="place-location-note">{t.pinNote}</Note>
        <SavePlaceButton label={place.label} point={point} source="pin" testId="place-save" />
        <section className="pn-section" aria-labelledby={`${uid}-pins`}>
          <h2 id={`${uid}-pins`} className="pn-section__title">
            {t.pinsWithName}
          </h2>
          <ul className="pn-group" data-testid="place-pins">
            {place.pins.map((p) => (
              <ListCell
                key={p.stopId}
                href={`/app/stops/${p.stopId}`}
                title={`${p.code ?? t.noCode} · ${p.layer ?? t.noLayer}`}
                sub={p.onRoute ? t.onRoute : t.notOnRoute}
                subTone="gold"
              />
            ))}
          </ul>
        </section>
        <FactRows rows={rows} label={t.aboutPlace} />
        <StopStreetView what="place" lat={point.lat} lng={point.lng} name={place.label} />
        {photoForPinPlace(place.label, place.pins) ? <ReferencePhoto photo={photoForPinPlace(place.label, place.pins)!} stop /> : <PhotoPending />}
      </main>
    </DetailPanel>
  );
}

// ------------------------------------------------------------------ barangay

function BarangayView({ place }: { place: SearchIndex["barangays"][number] }) {
  const tt = useT();
  const t = tt.places;
  const frame = useAppFrame();
  const returnToMap = useReturnToMap();
  const [which, setWhich] = useState<EndpointWhich>("destination");
  const rows: Row[] = [
    { key: "boundary", label: t.boundary, value: t.notMapped, testId: "place-boundary" },
  ];
  return (
    <DetailPanel title={tt.detail.place} sources={codedSourcesHref(place.sourceCode ? [place.sourceCode] : [])} testId="place-detail">
      <main className="pn-detail__main pn-detail-in">
        <PlaceHead title={place.name} kind={t.barangay} badges={["not-surveyed"]} />
        <DirectionsChoice which={which} onChange={setWhich} />
        <PrimaryAction
          onClick={() => {
            frame?.requestPick(which);
            returnToMap();
          }}
        >
          {t.chooseIn(place.name)}
        </PrimaryAction>
        <Note testId="place-location-note">{t.noLocationPlacePin}</Note>
        <FactRows rows={rows} label={t.aboutBarangay} />
      </main>
    </DetailPanel>
  );
}

// ------------------------------------------------------------------ 2025 study label

function StudyLabelView({ place }: { place: SearchIndex["studyLabels"][number] }) {
  const tt = useT();
  const t = tt.places;
  const rows: Row[] = [
    { key: "route", label: t.route, value: studyRouteText(place.routeCode, place.direction, t), testId: "place-route" },
    { key: "location", label: t.location, value: t.schematic, testId: "place-location" },
    { key: "status", label: t.status, value: t.historical, testId: "place-status" },
  ];
  return (
    <DetailPanel title={tt.detail.place} sources={codedSourcesHref(place.sourceCodes)} testId="place-detail">
      <main className="pn-detail__main pn-detail-in">
        <PlaceHead title={place.label} kind={studyKindText(place.sourceContext, t)} badges={["documented"]} />
        <Note testId="place-location-note">{t.noLocationStudy}</Note>
        <Link className="pn-text-btn pn-place__link" href={searchHref(place.label)} data-testid="place-search-link">
          {t.searchStops(place.label)}
        </Link>
        <FactRows rows={rows} label={t.aboutLabel} />
      </main>
    </DetailPanel>
  );
}
