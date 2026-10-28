// What S24 lists, from one validated intercity guide. Pure: no React, no clock (the caller passes
// Manila's date), no copy. Services are never ranked against each other beyond sortServices
// (status, then code), and fares are never added together.
import {
  DESTINATION_GROUPS,
  INTERCITY_MODES,
  type Intercity,
  type IntercityDestination,
  type IntercityService,
} from "@/domain/api/schemas";
import { isStale, sectionOf, sortServices } from "@/domain/intercity/present";
import { foldText } from "@/domain/search/normalize";

export type IntercityMode = IntercityService["mode"];
export type DestinationGroup = IntercityDestination["groupCode"];

/** `?to=` as a destination code (D-LEGAZPI), or null when absent or malformed. */
export function parseDestinationParam(raw: string | null): string | null {
  if (raw === null) return null;
  const code = raw.trim().toUpperCase();
  return /^D-[A-Z0-9-]{2,30}$/.test(code) ? code : "";
}

/** Every service naming `code`, split into running (sorted) and not running (sorted). */
export function servicesFor(data: Intercity, code: string): { running: IntercityService[]; notRunning: IntercityService[] } {
  const list = sortServices(data.services.filter((s) => s.destinationCodes.includes(code)));
  return {
    running: list.filter((s) => sectionOf(s.status) === "running"),
    notRunning: list.filter((s) => sectionOf(s.status) === "not_running"),
  };
}

/** The modes of the running services to `code`, in the fixed mode order. */
export function runningModes(data: Intercity, code: string): IntercityMode[] {
  const modes = new Set(servicesFor(data, code).running.map((s) => s.mode));
  return INTERCITY_MODES.filter((m) => modes.has(m));
}

/** Whether any running service on the page is past its review date (the stale banner). */
export const anyStale = (services: readonly IntercityService[], today: string): boolean =>
  services.some((s) => isStale(s.reviewBy, today));

const matches = (d: IntercityDestination, q: string) =>
  q === "" || [d.name, ...d.aliases].some((text) => foldText(text).includes(q));

/** Destinations matching `query` (name or alias, folded), grouped in the fixed group order, A–Z inside. */
export function groupedDestinations(
  data: Intercity,
  query: string,
): { group: DestinationGroup; destinations: IntercityDestination[] }[] {
  const q = foldText(query);
  return DESTINATION_GROUPS.map((group) => ({
    group,
    destinations: data.destinations
      .filter((d) => d.groupCode === group && matches(d, q))
      .sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((g) => g.destinations.length > 0);
}

/** Rail services (the rail card) and flights (the airport card), sorted by status then code. */
export const railServices = (data: Intercity) => sortServices(data.services.filter((s) => s.mode === "rail"));
export const airServices = (data: Intercity) => sortServices(data.services.filter((s) => s.mode === "air"));

/** The reviewed "planned, not funded" note of the South Long Haul, when published (never a service). */
export function southLongHaulNote(data: Intercity): boolean {
  return data.notes.some((n) => n.key === "intercity_south_long_haul" && n.value.trainsRun !== true);
}

/** The operators the service name does not already say ("DLTB Naga–Manila" already names DLTB). */
export const extraOperators = (s: IntercityService): string[] => s.operators.filter((o) => !s.name.includes(o));

/** A fare observation belongs on this destination's page when it names it or names none. */
export const observationsFor = (s: IntercityService, code: string) =>
  s.observations.filter((o) => o.destinationCode === null || o.destinationCode === code);

/** Destination codes of a service that are listed (for a rail or flight row's link). */
export function firstListedDestination(data: Intercity, s: IntercityService): IntercityDestination | null {
  for (const code of s.destinationCodes) {
    const d = data.destinations.find((x) => x.code === code);
    if (d) return d;
  }
  return null;
}
