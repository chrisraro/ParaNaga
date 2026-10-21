// Roadside advice and two-way corridor direction suggestions for Naga City jeepney routes.
// Helps commuters know which side of the street to wait on (e.g. Westbound to Centro vs Eastbound to Diversion),
// especially on major two-way corridors like Magsaysay Ave, Roxas Ave (Diversion), Peñafrancia Ave, and Centro.
// Pure and deterministic.

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

/**
 * Detects the corridor of a boarding point in Naga City based on coordinates and stop name.
 */
function detectCorridor(point: PointLike): { name: string; isTwoWay: boolean } | null {
  const name = (point.name ?? "").toLowerCase();

  // Name-based detection
  if (name.includes("magsaysay")) return { name: "Magsaysay Ave", isTwoWay: true };
  if (name.includes("roxas") || name.includes("diversion")) return { name: "Roxas Ave (Diversion)", isTwoWay: true };
  if (name.includes("peñafrancia") || name.includes("penafrancia") || name.includes("francia")) return { name: "Peñafrancia Ave", isTwoWay: true };
  if (name.includes("panganiban")) return { name: "Panganiban Drive", isTwoWay: true };
  if (name.includes("bagumbayan")) return { name: "Bagumbayan", isTwoWay: true };
  if (name.includes("plaza rizal") || name.includes("general luna") || name.includes("gen. luna") || name.includes("elias angeles") || name.includes("centro")) {
    return { name: "Centro", isTwoWay: false };
  }

  // Coordinate bounding boxes in Naga City
  const { lat, lng } = point;

  // Centro / Plaza Rizal / Gen. Luna (approx 13.6210 - 13.6265, 123.1810 - 123.1875)
  if (lat >= 13.6210 && lat <= 13.6265 && lng >= 123.1810 && lng <= 123.1875) {
    return { name: "Centro", isTwoWay: false };
  }

  // Peñafrancia Ave corridor (approx 13.6265 - 13.6370, 123.1850 - 123.1930)
  if (lat >= 13.6265 && lat <= 13.6370 && lng >= 123.1850 && lng <= 123.1930) {
    return { name: "Peñafrancia Ave", isTwoWay: true };
  }

  // Magsaysay Ave corridor (approx 13.6275 - 13.6340, 123.1920 - 123.2030)
  if (lat >= 13.6275 && lat <= 13.6340 && lng >= 123.1920 && lng <= 123.2030) {
    return { name: "Magsaysay Ave", isTwoWay: true };
  }

  // Roxas Ave / Diversion Road corridor (approx 13.6160 - 13.6280, 123.1950 - 123.2040)
  if (lat >= 13.6160 && lat <= 13.6280 && lng >= 123.1950 && lng <= 123.2040) {
    return { name: "Roxas Ave (Diversion)", isTwoWay: true };
  }

  // Panganiban Drive (approx 13.6200 - 13.6255, 123.1875 - 123.1970)
  if (lat >= 13.6200 && lat <= 13.6255 && lng >= 123.1875 && lng <= 123.1970) {
    return { name: "Panganiban Drive", isTwoWay: true };
  }

  // Bagumbayan corridor (approx 13.6270 - 13.6390, 123.1780 - 123.1860)
  if (lat >= 13.6270 && lat <= 13.6390 && lng >= 123.1780 && lng <= 123.1860) {
    return { name: "Bagumbayan", isTwoWay: true };
  }

  return null;
}

/**
 * Returns roadside boarding guidance for a jeepney route and boarding location.
 */
export function getRoadsideAdvice(
  routeCode: string,
  boardPoint: PointLike | null,
  alightPoint?: PointLike | null,
): RoadsideInfo | null {
  if (!boardPoint) return null;

  const detected = detectCorridor(boardPoint);
  const corridor = detected?.name ?? "Street";
  const isTwoWay = detected?.isTwoWay ?? false;

  // 1. Magsaysay Avenue
  if (corridor === "Magsaysay Ave") {
    // Loop B and Loop D run Northbound/Westbound toward Peñafrancia & Centro
    if (routeCode === "R8-B" || routeCode === "R8-D") {
      return {
        chip: "Westbound side · to Centro",
        advice: "Two-way street: Wait on the North / Westbound side of Magsaysay Ave (facing Peñafrancia & Centro) · Signboard: " + (routeCode === "R8-B" ? "Loop B" : "Loop D"),
        heading: "westbound",
        corridor,
        isTwoWay: true,
      };
    }
    // Loop A and Loop C run Southbound/Eastbound toward Diversion Road / SM
    if (routeCode === "R8-A" || routeCode === "R8-C") {
      return {
        chip: "Eastbound side · to Diversion",
        advice: "Two-way street: Wait on the South / Eastbound side of Magsaysay Ave (facing Diversion Road / SM) · Signboard: " + (routeCode === "R8-A" ? "Loop A" : "Loop C"),
        heading: "eastbound",
        corridor,
        isTwoWay: true,
      };
    }
    // R1 / R2 heading to Centro (inbound)
    if (alightPoint && (alightPoint.name?.toLowerCase().includes("centro") || alightPoint.name?.toLowerCase().includes("plaza rizal") || alightPoint.lng < boardPoint.lng)) {
      return {
        chip: "Westbound side · to Centro",
        advice: `Two-way street: Wait on the North / Westbound side of Magsaysay Ave (facing Centro) · Signboard: ${routeCode}`,
        heading: "westbound",
        corridor,
        isTwoWay: true,
      };
    }
    // R1 / R2 heading outbound
    return {
      chip: "Eastbound side · Outbound",
      advice: `Two-way street: Wait on the South / Eastbound side of Magsaysay Ave (facing outbound) · Signboard: ${routeCode}`,
      heading: "eastbound",
      corridor,
      isTwoWay: true,
    };
  }

  // 2. Roxas Ave (Diversion Road)
  if (corridor === "Roxas Ave (Diversion)") {
    // Loop B and Loop D run Northbound toward Magsaysay Ave
    if (routeCode === "R8-B" || routeCode === "R8-D") {
      return {
        chip: "Northbound side · to Magsaysay",
        advice: "Two-way street: Wait on the East / Northbound side of Roxas Ave (facing Magsaysay Ave) · Signboard: " + (routeCode === "R8-B" ? "Loop B" : "Loop D"),
        heading: "northbound",
        corridor,
        isTwoWay: true,
      };
    }
    // Loop A and Loop C run Southbound toward Panganiban / Centro
    if (routeCode === "R8-A" || routeCode === "R8-C") {
      return {
        chip: "Southbound side · to Centro",
        advice: "Two-way street: Wait on the West / Southbound side of Roxas Ave (facing Panganiban / Centro) · Signboard: " + (routeCode === "R8-A" ? "Loop A" : "Loop C"),
        heading: "southbound",
        corridor,
        isTwoWay: true,
      };
    }
    // R3 (Roxas Ave)
    if (routeCode === "R3") {
      const inbound = alightPoint && (alightPoint.name?.toLowerCase().includes("centro") || alightPoint.name?.toLowerCase().includes("plaza rizal"));
      return {
        chip: inbound ? "Southbound side · to Centro" : "Outbound side · to Del Rosario",
        advice: `Two-way street: Wait on the ${inbound ? "West / Southbound" : "East / Northbound"} side of Roxas Ave · Signboard: Route 3 (Roxas Ave)`,
        heading: inbound ? "southbound" : "northbound",
        corridor,
        isTwoWay: true,
      };
    }
  }

  // 3. Peñafrancia Ave (Francia)
  if (corridor === "Peñafrancia Ave") {
    // Loop A and Loop C run Northbound toward Magsaysay Ave
    if (routeCode === "R8-A" || routeCode === "R8-C") {
      return {
        chip: "Northbound side · to Magsaysay",
        advice: "Two-way street: Wait on the East / Northbound side of Peñafrancia Ave (facing Magsaysay Ave) · Signboard: " + (routeCode === "R8-A" ? "Loop A" : "Loop C"),
        heading: "northbound",
        corridor,
        isTwoWay: true,
      };
    }
    // Loop B and Loop D run Southbound toward Centro / Plaza Rizal
    if (routeCode === "R8-B" || routeCode === "R8-D") {
      return {
        chip: "Southbound side · to Centro",
        advice: "Two-way street: Wait on the West / Southbound side of Peñafrancia Ave (facing Plaza Rizal & Centro) · Signboard: " + (routeCode === "R8-B" ? "Loop B" : "Loop D"),
        heading: "southbound",
        corridor,
        isTwoWay: true,
      };
    }
    // R5, R6, R7 (Peñafrancia / San Felipe / Pacol / Carolina)
    if (["R5", "R6", "R7", "R2"].includes(routeCode)) {
      const inbound = alightPoint && (alightPoint.name?.toLowerCase().includes("centro") || alightPoint.name?.toLowerCase().includes("plaza rizal"));
      return {
        chip: inbound ? "Southbound side · to Centro" : "Northbound side · Outbound",
        advice: `Two-way street: Wait on the ${inbound ? "West / Southbound (facing Centro)" : "East / Northbound (facing San Felipe/Pacol)"} side of Peñafrancia Ave · Signboard: ${routeCode}`,
        heading: inbound ? "southbound" : "northbound",
        corridor,
        isTwoWay: true,
      };
    }
  }

  // 4. Bagumbayan
  if (corridor === "Bagumbayan") {
    if (routeCode === "R8-C") {
      return {
        chip: "Northbound side · to Magsaysay",
        advice: "Wait on the Northbound side of Bagumbayan (facing M.T. Villanueva & Magsaysay) · Signboard: Loop C",
        heading: "northbound",
        corridor,
        isTwoWay: true,
      };
    }
    if (routeCode === "R8-D") {
      return {
        chip: "Southbound side · to Centro",
        advice: "Wait on the Southbound side of Bagumbayan (facing Elias Angeles & Centro) · Signboard: Loop D",
        heading: "southbound",
        corridor,
        isTwoWay: true,
      };
    }
  }

  // 5. Panganiban Drive
  if (corridor === "Panganiban Drive") {
    const inbound = alightPoint && (alightPoint.name?.toLowerCase().includes("centro") || alightPoint.name?.toLowerCase().includes("plaza rizal"));
    return {
      chip: inbound ? "Westbound side · to Centro" : "Eastbound side · to Del Rosario",
      advice: `Two-way street: Wait on the ${inbound ? "North / Westbound (facing Centro)" : "South / Eastbound (facing Diversion)"} side of Panganiban Dr · Signboard: ${routeCode}`,
      heading: inbound ? "westbound" : "eastbound",
      corridor,
      isTwoWay: true,
    };
  }

  // 6. Centro (Gen. Luna / Elias Angeles / Plaza area)
  if (corridor === "Centro") {
    if (routeCode === "R8-A" || routeCode === "R8-C") {
      return {
        chip: "Centro / Gen. Luna",
        advice: "Board along Gen. Luna facing North toward Peñafrancia & Magsaysay · Signboard: " + (routeCode === "R8-A" ? "Loop A" : "Loop C"),
        heading: "terminal",
        corridor,
        isTwoWay: false,
      };
    }
    if (routeCode === "R8-B" || routeCode === "R8-D") {
      return {
        chip: "Gen. Luna / Elias Angeles",
        advice: "Board along Gen. Luna / Elias Angeles facing West toward Biak-na-Bato & Diversion · Signboard: " + (routeCode === "R8-B" ? "Loop B" : "Loop D"),
        heading: "terminal",
        corridor,
        isTwoWay: false,
      };
    }
    return {
      chip: "Centro terminal / roadside",
      advice: `Board at Centro terminal area · Signboard: ${routeCode}`,
      heading: "terminal",
      corridor,
      isTwoWay: false,
    };
  }

  // General fallback for loops or lines
  if (routeCode === "R8-B" || routeCode === "R8-D") {
    return {
      chip: "Counterclockwise Loop",
      advice: `Check signboard "${routeCode === "R8-B" ? "Loop B" : "Loop D"}" · Counterclockwise service`,
      heading: "westbound",
      corridor,
      isTwoWay,
    };
  }
  if (routeCode === "R8-A" || routeCode === "R8-C") {
    return {
      chip: "Clockwise Loop",
      advice: `Check signboard "${routeCode === "R8-A" ? "Loop A" : "Loop C"}" · Clockwise service`,
      heading: "eastbound",
      corridor,
      isTwoWay,
    };
  }

  return null;
}
