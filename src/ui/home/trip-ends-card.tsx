"use client";

import { endpointLabel, type Endpoint, type EndpointWhich, type EndpointsState } from "@/domain/trip/endpoints";
import { useT } from "@/i18n/provider";

function StartIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <circle cx="7" cy="7" r="5" fill="currentColor" />
    </svg>
  );
}

function DestinationIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 22s-7-6.6-7-12a7 7 0 0 1 14 0c0 5.4-7 12-7 12z" fill="currentColor" />
      <circle cx="12" cy="10" r="2.6" fill="#FFFFFF" />
    </svg>
  );
}

/** DOM id of an endpoint row's main button, so the screen can move focus to it. */
export function endpointRowMainId(which: EndpointWhich): string {
  return `pn-endpoint-${which}-main`;
}

type RowProps = {
  which: EndpointWhich;
  endpoint: Endpoint | null;
  focused: boolean;
  sub?: string | undefined;
  onFocus: (which: EndpointWhich) => void;
  onClear: (which: EndpointWhich) => void;
};

function EndpointRow({ which, endpoint, focused, sub, onFocus, onClear }: RowProps) {
  const t = useT();
  const home = t.home;
  return (
    <div className={focused ? "pn-endpoint pn-endpoint--focused" : "pn-endpoint"} data-testid={`endpoint-${which}`}>
      <button type="button" id={endpointRowMainId(which)} className="pn-endpoint__main" aria-pressed={focused} onClick={() => onFocus(which)}>
        <span className={`pn-endpoint__icon pn-endpoint__icon--${which}`}>
          {which === "start" ? <StartIcon /> : <DestinationIcon />}
        </span>
        <span className="pn-endpoint__text">
          <span className="sr-only">{which === "start" ? home.start : home.destination}: </span>
          <span className={endpoint ? "pn-endpoint__value" : "pn-endpoint__value pn-endpoint__value--empty"}>
            {endpoint ? endpointLabel(endpoint.source, endpoint.label, t.trip) : which === "start" ? home.chooseStart : home.whereTo}
          </span>
          {sub ? <span className="pn-endpoint__sub">{sub}</span> : null}
        </span>
      </button>
      {endpoint ? (
        <button type="button" className="pn-icon-btn" aria-label={which === "start" ? home.clearStart : home.clearDestination} onClick={() => onClear(which)}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

export type TripEndsCardProps = {
  endpoints: Pick<EndpointsState, "start" | "destination">;
  focused: EndpointWhich | null;
  startSub?: string | undefined;
  destinationSub?: string | undefined;
  onFocus: (which: EndpointWhich) => void;
  onClear: (which: EndpointWhich) => void;
  onSwap: () => void;
};

export function TripEndsCard({
  endpoints,
  focused,
  startSub,
  destinationSub,
  onFocus,
  onClear,
  onSwap,
}: TripEndsCardProps) {
  const home = useT().home;
  return (
    <div className="pn-endpoints" data-testid="trip-ends">
      <EndpointRow which="start" endpoint={endpoints.start} focused={focused === "start"} sub={startSub} onFocus={onFocus} onClear={onClear} />
      <div className="pn-endpoints__sep" />
      <EndpointRow which="destination" endpoint={endpoints.destination} focused={focused === "destination"} sub={destinationSub} onFocus={onFocus} onClear={onClear} />
      <button
        type="button"
        className="pn-icon-btn pn-swap"
        aria-label={home.swap}
        disabled={!endpoints.start && !endpoints.destination}
        onClick={onSwap}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M8 4v16M8 4L4.5 7.5M8 4l3.5 3.5M16 20V4M16 20l-3.5-3.5M16 20l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
