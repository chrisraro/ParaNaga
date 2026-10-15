// Location status for the home sheet: what the GPS is doing, in plain words, and the manual
// pinning path whenever GPS can't (or mustn't) be the trip start. Copy follows the Task 6
// brief and Global Constraints; the helper is pure so every state is unit-tested.

import type { GeolocationState } from "@/client/geo/use-geolocation";
import type { FixAssessment } from "@/domain/geo/location-fix";

export type LocationStatusKind =
  | "requesting"
  | "precise"
  | "approximate"
  | "coarse"
  | "outside_city"
  | "denied"
  | "unavailable"
  | "timeout"
  | "unsupported"
  | "insecure";

export type LocationStatusTone = "neutral" | "ok" | "info" | "warn" | "error";

export type LocationStatusCopy = {
  kind: LocationStatusKind;
  tone: LocationStatusTone;
  title: string;
  detail?: string;
  /** The sheet offers "Choose start on map" with this status. */
  action?: "pick_start";
  /** Button label for `action`; defaults to "Choose start on map". */
  actionLabel?: string;
};

const PIN_LATER = "You can still pin your start on the map.";

/** "± 25 m": accuracy rounded to whole metres. */
export function formatAccuracy(metres: number): string {
  return `± ${Math.round(metres)} m`;
}

/** "last fix 45 s ago" / "last fix 2 min ago": the age of the fix an endpoint was set from. */
export function formatFixAge(ageMs: number): string {
  const s = Math.round(Math.max(0, ageMs) / 1000);
  if (s < 5) return "last fix just now";
  if (s < 60) return `last fix ${s} s ago`;
  return `last fix ${Math.round(s / 60)} min ago`;
}

const known = (metres: number | null): metres is number => metres !== null && Number.isFinite(metres);

export function locationStatusCopy(
  state: GeolocationState,
  assessment: FixAssessment | null,
  accuracy: number | null,
  /**
   * gpsEndpointSet: a trip endpoint already comes from GPS. A fix that has aged past STALE_MS can
   * no longer become a NEW start, but it stays the honest position of that endpoint (a phone that
   * is not moving gets no new fixes), so it must not flip back to "Finding your location…".
   */
  { gpsEndpointSet = false }: { gpsEndpointSet?: boolean } = {},
): LocationStatusCopy | null {
  switch (state) {
    case "idle":
      return null;
    case "denied":
      return {
        kind: "denied",
        tone: "error",
        title: `Location is off. ${PIN_LATER}`,
        detail: "To turn it on, allow location for this site in your browser settings.",
        action: "pick_start",
      };
    case "unavailable":
    case "timeout":
      return {
        kind: state,
        tone: "warn",
        title: `Can't get your location right now. ${PIN_LATER}`,
        action: "pick_start",
      };
    case "unsupported":
      return {
        kind: "unsupported",
        tone: "warn",
        title: `This browser can't share your location. ${PIN_LATER}`,
        action: "pick_start",
      };
    case "insecure":
      return {
        kind: "insecure",
        tone: "warn",
        title: `Location needs a secure (https) connection. ${PIN_LATER}`,
        action: "pick_start",
      };
    case "requesting":
    case "watching":
      break;
  }

  if (state === "requesting" || assessment === null || (assessment.stale && !gpsEndpointSet)) {
    return { kind: "requesting", tone: "neutral", title: "Finding your location…" };
  }
  // Outside the city the fix is never the start, whatever its accuracy.
  if (!assessment.insideCity) {
    return {
      kind: "outside_city",
      tone: "info",
      title: "You're outside Naga City. Pin your starting point in Naga, or choose a point on the map.",
      action: "pick_start",
    };
  }
  if (assessment.quality === "coarse") {
    const rough = known(accuracy) ? `Location too rough (${formatAccuracy(accuracy)}).` : "Location too rough.";
    return { kind: "coarse", tone: "warn", title: `${rough} Pin your start on the map.`, action: "pick_start" };
  }
  const detail = known(accuracy) ? { detail: formatAccuracy(accuracy) } : {};
  if (assessment.quality === "approximate") {
    return {
      kind: "approximate",
      tone: "warn",
      title: "Your location is approximate. Check the pin or move it.",
      ...detail,
      action: "pick_start",
      actionLabel: "Move start pin",
    };
  }
  return { kind: "precise", tone: "ok", title: "You are here", ...detail };
}

type Props = {
  copy: LocationStatusCopy;
  onPickStart: () => void;
};

/** The status card in the sheet. Announcements go through the home screen's live region. */
export function LocationStatus({ copy, onPickStart }: Props) {
  return (
    <div className={`pn-status pn-status--${copy.tone}`} data-testid="location-status" data-kind={copy.kind}>
      <svg className="pn-status__icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        {copy.tone === "neutral" ? (
          <circle className="pn-status__spinner" cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="34 50" />
        ) : (
          <>
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M12 8v5M12 16h.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </>
        )}
      </svg>
      <div className="pn-status__body">
        <p className="pn-status__title">{copy.title}</p>
        {copy.detail && copy.kind !== "approximate" && copy.kind !== "precise" ? (
          <p className="pn-status__detail">{copy.detail}</p>
        ) : null}
        {copy.action === "pick_start" ? (
          <button type="button" className="pn-status__action" onClick={onPickStart}>
            {copy.actionLabel ?? "Choose start on map"}
          </button>
        ) : null}
      </div>
      {copy.detail && (copy.kind === "approximate" || copy.kind === "precise") ? (
        <span className="pn-chip">{copy.detail}</span>
      ) : null}
    </div>
  );
}
