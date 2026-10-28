// Roadside advice and two-way corridor direction suggestions for Naga City jeepney routes.
// Helps commuters know which side of the street to wait on (e.g. Westbound to Centro vs Eastbound to Diversion),
// especially on major two-way corridors like Magsaysay Ave, Roxas Ave (Diversion), Peñafrancia Ave, and Centro.
// Pure and deterministic.
import { en, type Dict } from "@/i18n/dict";
import type { LoopDirection } from "../trip/present";

export type RoadsideHeading = "northbound" | "southbound" | "eastbound" | "westbound" | "terminal";

export type RoadsideInfo = {
  /** Short badge/chip for the option card (e.g. "Westbound side · to Centro") */
  chip: string;
  /** Comprehensive advice for the boarding step in trip details */
  advice: string;
  /** Direction of travel at the boarding roadside */
  heading: RoadsideHeading;
  /** Recognized corridor name (e.g. "Magsaysay Ave", "Roxas Ave (Diversion)", "Peñafrancia Ave", "Centro") */
  corridor: string;
  /** Whether the corridor at the boarding point is a two-way street */
  isTwoWay: boolean;
};

type PointLike = { lat: number; lng: number; name?: string | null };

const NAMES: [string, RegExp][] = [
  ["Magsaysay Ave", /magsaysay/],
  ["Roxas Ave (Diversion)", /roxas|diversion/],
  ["Peñafrancia Ave", /peñafrancia|penafrancia|francia/],
  ["Panganiban Drive", /panganiban/],
  ["Bagumbayan", /bagumbayan/],
  ["Centro", /plaza rizal|general luna|gen\. luna|elias angeles|centro/],
];
// Approximate corridor boxes in Naga City: [corridor, lat min, lat max, lng min, lng max]. Some overlap.
const BOXES: [string, number, number, number, number][] = [
  ["Centro", 13.621, 13.6265, 123.181, 123.1875],
  ["Peñafrancia Ave", 13.6265, 13.637, 123.185, 123.193],
  ["Magsaysay Ave", 13.6275, 13.634, 123.192, 123.203],
  ["Roxas Ave (Diversion)", 13.616, 13.628, 123.195, 123.204],
  ["Panganiban Drive", 13.62, 13.6255, 123.1875, 123.197],
  ["Bagumbayan", 13.627, 13.639, 123.178, 123.186],
];
const only = (names: string[]) => (new Set(names).size === 1 ? names[0]! : null);

/** The one corridor a boarding point is on, by its name, else by the boxes; null when none or ambiguous (two match). */
function detectCorridor(point: PointLike): string | null {
  const name = (point.name ?? "").toLowerCase();
  const byName = NAMES.filter(([, re]) => re.test(name)).map(([c]) => c);
  if (byName.length > 0) return only(byName);
  const { lat, lng } = point;
  return only(BOXES.filter(([, a, b, c, d]) => lat >= a && lat <= b && lng >= c && lng <= d).map(([c]) => c));
}

/** The R8 loops: ordinance direction and the corridors each runs on (route-display sources, Ord 2025-070). */
const LOOPS: Record<string, { label: string; direction: LoopDirection; corridors: readonly string[] }> = {
  "R8-A": { label: "Loop A", direction: "clockwise", corridors: ["Peñafrancia Ave", "Magsaysay Ave", "Roxas Ave (Diversion)", "Centro"] },
  "R8-B": { label: "Loop B", direction: "counterclockwise", corridors: ["Roxas Ave (Diversion)", "Magsaysay Ave", "Peñafrancia Ave", "Centro"] },
  "R8-C": { label: "Loop C", direction: "clockwise", corridors: ["Centro", "Peñafrancia Ave", "Bagumbayan", "Magsaysay Ave", "Roxas Ave (Diversion)"] },
  "R8-D": { label: "Loop D", direction: "counterclockwise", corridors: ["Centro", "Roxas Ave (Diversion)", "Magsaysay Ave", "Bagumbayan"] },
};

/**
 * Roadside boarding guidance, or null. Only for an R8 loop whose known direction (from the plan's variant, never
 * guessed) matches its ordinance direction, boarding on one corridor that loop runs on: no data is invented.
 */
export function getRoadsideAdvice(
  routeCode: string,
  direction: LoopDirection | null,
  boardPoint: PointLike | null,
  copy: Dict["trip"]["roadside"] = en.trip.roadside,
): RoadsideInfo | null {
  const loop = LOOPS[routeCode];
  if (!boardPoint || !loop || direction !== loop.direction) return null;
  const corridor = detectCorridor(boardPoint);
  if (corridor === null || !loop.corridors.includes(corridor)) return null;
  const cw = direction === "clockwise";
  const info = (chip: string, advice: string, heading: RoadsideHeading): RoadsideInfo => ({ chip, advice, heading, corridor, isTwoWay: corridor !== "Centro" });
  switch (corridor) {
    case "Magsaysay Ave":
      return cw ? info(copy.chipEastDiversion, copy.magsaysayEast(loop.label), "eastbound") : info(copy.chipWestCentro, copy.magsaysayWest(loop.label), "westbound");
    case "Roxas Ave (Diversion)":
      return cw ? info(copy.chipSouthCentro, copy.roxasSouth(loop.label), "southbound") : info(copy.chipNorthMagsaysay, copy.roxasNorth(loop.label), "northbound");
    case "Peñafrancia Ave":
      return cw ? info(copy.chipNorthMagsaysay, copy.franciaNorth(loop.label), "northbound") : info(copy.chipSouthCentro, copy.franciaSouth(loop.label), "southbound");
    case "Bagumbayan":
      return cw ? info(copy.chipNorthMagsaysay, copy.bagumbayanNorth, "northbound") : info(copy.chipSouthCentro, copy.bagumbayanSouth, "southbound");
    case "Centro":
      return cw ? info(copy.chipCentroGenLuna, copy.centroNorth(loop.label), "terminal") : info(copy.chipGenLunaElias, copy.centroWest(loop.label), "terminal");
    default:
      return null;
  }
}
