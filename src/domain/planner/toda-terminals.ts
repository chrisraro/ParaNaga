// TODA terminals and dedicated pickup/drop-off service points (owner 2026-10-21).
// Pure: no DOM, no I/O.
// Captures official & community TODA terminals in Naga City, including the Evangelista St
// terminal in Plaza Rizal (serving Ateneo de Naga, Bagumbayan-Queborac, Calauag, Bagumbayan Norte)
// and the Plaza Rizal East terminal (serving SM City Naga, Bus Terminal, Panganiban Dr,
// Ninoy & Cory Ave, Naga City Subdivision).

import { haversineMeters } from "../geo/geometry";
import type { LatLng } from "../geo/types";

export type TodaTerminal = {
  code: string;
  name: string;
  lat: number;
  lng: number;
  todas: string[];
  destinations: string[];
  description: string;
  source: string;
};

export const TODA_TERMINALS: readonly TodaTerminal[] = [
  {
    code: "T17",
    name: "Evangelista Tricycle Terminal (Plaza Rizal)",
    lat: 13.6229307,
    lng: 123.1847557,
    todas: ["Plaza Rizal-Evangelista TODA (to Ateneo de Naga, Queborac, Calauag, Bagumbayan Norte)"],
    destinations: [
      "Ateneo de Naga",
      "Bagumbayan-Queborac",
      "Calauag",
      "Bagumbayan Norte Boundary",
    ],
    description: "Onboards passengers to Ateneo de Naga, Queborac, Calauag, and Bagumbayan Norte",
    source: "Community report / owner verification (Plaza Rizal Evangelista St)",
  },
  {
    code: "T18",
    name: "Ateneo de Naga Tricycle Terminal",
    lat: 13.6309527,
    lng: 123.1845589,
    todas: ["Ateneo TODA"],
    destinations: ["Plaza Rizal (Centro)", "Evangelista Street", "Bagumbayan"],
    description: "Tricycle terminal at Ateneo de Naga University",
    source: "Community report / owner verification (Ateneo de Naga)",
  },
  {
    code: "T19",
    name: "Bagumbayan-Queborac Terminal",
    lat: 13.6340689,
    lng: 123.1852198,
    todas: ["Bagumbayan-Queborac TODA"],
    destinations: ["Plaza Rizal (Centro)", "Evangelista Street", "Ateneo de Naga"],
    description: "Jeepney and tricycle terminal on Queborac Street",
    source: "Community report / owner verification (Bagumbayan Queborac)",
  },
  {
    code: "T20",
    name: "Calauag Tricycle Terminal",
    lat: 13.6419237,
    lng: 123.1906521,
    todas: ["Calauag TODA"],
    destinations: ["Plaza Rizal (Centro)", "Evangelista Street"],
    description: "Tricycle terminal in Calauag",
    source: "Community report / owner verification (Calauag)",
  },
  {
    code: "T21",
    name: "Bagumbayan Norte Boundary Terminal",
    lat: 13.6397563,
    lng: 123.1855635,
    todas: ["Bagumbayan Norte TODA"],
    destinations: ["Plaza Rizal (Centro)", "Evangelista Street"],
    description: "Tricycle terminal at Bagumbayan Norte boundary",
    source: "Community report / owner verification (Bagumbayan Norte)",
  },
  {
    code: "T22",
    name: "Plaza Rizal East Tricycle Terminal",
    lat: 13.6233581,
    lng: 123.1852000,
    todas: ["Plaza Rizal-Panganiban TODA (to SM City Naga, Bus Terminal, Panganiban, Ninoy & Cory Ave, Naga City Subd)"],
    destinations: [
      "SM City Naga",
      "Bicol Central Station (Bus Terminal)",
      "Panganiban Drive",
      "Ninoy and Cory Avenue",
      "Naga City Subdivision",
    ],
    description: "Onboards passengers to SM City Naga, Bus Terminal, Panganiban Drive, Ninoy & Cory Ave, and Naga City Subd",
    source: "Community report / owner verification (Plaza Rizal East)",
  },
  {
    code: "T23",
    name: "Naga City People's Mall / Public Market TODA Terminal",
    lat: 13.6218,
    lng: 123.1832,
    todas: ["People's Mall Tricycle Operators & Drivers Association (Green Zone)"],
    destinations: ["Abella", "Igualdad", "Sabang", "Mabolo Boundary", "Centro"],
    description: "Major terminal serving commuters and shoppers from the Public Market to inner barangays (Zone 2)",
    source: "INTRAP Ordinance 93-026 / Naga City Public Market records",
  },
  {
    code: "T24",
    name: "Bicol Central Station (BCS) Tricycle Terminal",
    lat: 13.6192359,
    lng: 123.1897426,
    todas: ["Bicol Central Station TODA (Triangulo / CBD II)"],
    destinations: ["Plaza Rizal (Centro)", "SM City Naga", "Peñafrancia", "Magsaysay Avenue", "San Felipe"],
    description: "Regional transit transfer hub connecting bus/van arrivals to citywide destinations",
    source: "Bicol Central Station Terminal dispatch / Ordinance 93-049",
  },
  {
    code: "T25",
    name: "SM City Naga Tricycle Transport Bay",
    lat: 13.6210765,
    lng: 123.1904389,
    todas: ["SM City Naga TODA / E-Trike Bay"],
    destinations: ["Centro / Plaza Rizal", "Panganiban Drive", "CBD I", "Triangulo", "Concepcion Pequeña"],
    description: "Dedicated tricycle and e-trike transport bay outside SM City Naga (CBD II)",
    source: "SM City Naga Transport Terminal guidelines / PSO verification",
  },
  {
    code: "T26",
    name: "Magsaysay Avenue TODA Terminal",
    lat: 13.6300,
    lng: 123.1950,
    todas: ["Magsaysay-Balatas TODA (Yellow Zone)"],
    destinations: ["Dayangdang", "Balatas", "Basilica Minore", "Centro"],
    description: "Feeder terminal serving the Magsaysay dining strip, Balatas, and Dayangdang (Zone 3)",
    source: "INTRAP Ordinance 93-026 / local TODA accreditation",
  },
  {
    code: "T27",
    name: "Concepcion Pequeña / Yashano Mall TODA Terminal",
    lat: 13.6180,
    lng: 123.2030,
    todas: ["Concepcion TODA (Yellow Zone)"],
    destinations: ["Villa Grande Homes", "Del Rosario Boundary", "Centro / Plaza Rizal", "Roxas Avenue"],
    description: "Feeder terminal along Maharlika Hwy / Roxas Ave serving residential subdivisions and shopping areas",
    source: "INTRAP Zone 3 / Sangguniang Panlungsod records",
  },
  {
    code: "T28",
    name: "Pacol Tricycle Terminal",
    lat: 13.6595434,
    lng: 123.2511904,
    todas: ["Pacol TODA"],
    destinations: ["Ateneo de Naga (Bonoan Campus)", "Carolina Boundary", "San Felipe", "Centro"],
    description: "Feeder terminal connecting Pacol residents and students to jeepney transfer hubs and uptown Naga",
    source: "Barangay Pacol transport directory",
  },
];

/**
 * Official Naga City fare policy under Ordinance No. 2024-002 amending the
 * Transport and Traffic Code (Ordinance No. 93-049).
 */
export const TODA_FARE_POLICY = {
  ordinance: "Ordinance No. 2024-002",
  governingCode: "Ordinance No. 93-049 (Transport and Traffic Code of Naga City)",
  zoningProgram: "INTRAP (Intra-City Trimobile Transport Rationalization Plan, Ord. 93-026)",
  baseDistanceKm: 3.0,
  regularMinFareCentavos: 1500, // ₱15.00
  discountedMinFareCentavos: 1200, // ₱12.00 (20% statutory discount: Students, Senior Citizens, PWDs, Solo Parents)
  specialTripCharterRangePesos: "₱60 – ₱100+",
  regulatoryAuthority: "Naga City Public Safety Office (PSO) & Trimobile Task Force (TTF)",
  colorZones: [
    { zone: "Zone 1", color: "Blue", units: "0001–0609", coverage: "Peñafrancia, San Francisco" },
    { zone: "Zone 2", color: "Green", units: "0759–1046", coverage: "Abella, Igualdad, Sabang" },
    { zone: "Zone 3", color: "Yellow", units: "1047–1500", coverage: "Tinago, Lerma, Concepcion Pequeña, Balatas, Dayangdang, Naga City Subdivision" },
    { zone: "Zone 4", color: "Red", units: "0610–0758", coverage: "Central Business District / Core Urban Corridors" },
  ],
} as const;

export type TodaRoute = {
  terminalName: string;
  terminalCode: string;
  destinations: string[];
  pickupPoint: string;
  dropOffTerminal: string | null;
  todaName: string;
  corridor: string;
  regularFarePesos?: number;
  discountedFarePesos?: number;
  fareBasis?: string;
};

/** Finds a specific TODA route connecting pickup and drop-off points. */
export function findTodaRoute(origin: LatLng, destination: LatLng): TodaRoute | null {
  const dEvangelista = haversineMeters(origin, { lat: 13.6229307, lng: 123.1847557 });
  const dPlazaRizal = haversineMeters(origin, { lat: 13.6233581, lng: 123.1848802 });
  const nearPlazaRizal = dEvangelista <= 500 || dPlazaRizal <= 500;

  if (nearPlazaRizal) {
    // 1. Toward Ateneo, Bagumbayan Queborac, Calauag, Bagumbayan Norte
    const dAteneo = haversineMeters(destination, { lat: 13.6309527, lng: 123.1845589 });
    const dQueborac = haversineMeters(destination, { lat: 13.6340689, lng: 123.1852198 });
    const dCalauag = haversineMeters(destination, { lat: 13.6419237, lng: 123.1906521 });
    const dBagumbayanNorte = haversineMeters(destination, { lat: 13.6397563, lng: 123.1855635 });

    if (
      dAteneo <= 600 ||
      dQueborac <= 600 ||
      dCalauag <= 600 ||
      dBagumbayanNorte <= 600 ||
      (destination.lat >= 13.628 && destination.lng <= 123.193)
    ) {
      const dropOff =
        dAteneo <= 600
          ? "Ateneo de Naga Tricycle Terminal"
          : dQueborac <= 600
            ? "Bagumbayan-Queborac Terminal"
            : dCalauag <= 600
              ? "Calauag Tricycle Terminal"
              : dBagumbayanNorte <= 600
                ? "Bagumbayan Norte Boundary Terminal"
                : null;

      return {
        terminalName: "Evangelista Tricycle Terminal (Plaza Rizal)",
        terminalCode: "T17",
        destinations: ["Ateneo de Naga", "Bagumbayan-Queborac", "Calauag", "Bagumbayan Norte Boundary"],
        pickupPoint: "Evangelista Street, Plaza Rizal",
        dropOffTerminal: dropOff,
        todaName: "Plaza Rizal-Evangelista TODA (to Ateneo de Naga, Queborac, Calauag, Bagumbayan Norte)",
        corridor: "Ateneo / Bagumbayan / Calauag corridor",
        regularFarePesos: 15,
        discountedFarePesos: 12,
        fareBasis: "Ordinance No. 2024-002 base minimum fare (first 3 km)",
      };
    }

    // 2. Toward SM City Naga, Bus Terminal, Panganiban Drive, Ninoy and Cory Avenue, Naga City Subdivision
    const dSM = haversineMeters(destination, { lat: 13.6210765, lng: 123.1904389 });
    const dBus = haversineMeters(destination, { lat: 13.6192359, lng: 123.1897426 });
    const dNagaCitySubd = haversineMeters(destination, { lat: 13.6196311, lng: 123.1964323 });
    const dPanganiban = destination.lng >= 123.187 && destination.lat <= 13.625 && destination.lat >= 13.618;

    if (dSM <= 500 || dBus <= 500 || dNagaCitySubd <= 600 || dPanganiban) {
      const dropOff =
        dSM <= 500
          ? "SM City Naga Transport Bay"
          : dBus <= 500
            ? "Bicol Central Station (Bus Terminal)"
            : dNagaCitySubd <= 600
              ? "Naga City Subdivision"
              : null;

      return {
        terminalName: "Plaza Rizal East Tricycle Terminal",
        terminalCode: "T22",
        destinations: ["SM City Naga", "Bus Terminal", "Panganiban Drive", "Ninoy & Cory Ave", "Naga City Subdivision"],
        pickupPoint: "Plaza Rizal (Panganiban Drive / Gen. Luna)",
        dropOffTerminal: dropOff,
        todaName: "Plaza Rizal-Panganiban TODA (to SM City Naga, Bus Terminal, Panganiban, Ninoy & Cory Ave, Naga City Subd)",
        corridor: "Panganiban / CBD II corridor",
        regularFarePesos: 15,
        discountedFarePesos: 12,
        fareBasis: "Ordinance No. 2024-002 base minimum fare (first 3 km)",
      };
    }
  }

  // Reverse routes:
  // From Ateneo de Naga to Centro / Plaza Rizal
  const fromAteneo = haversineMeters(origin, { lat: 13.6309527, lng: 123.1845589 }) <= 500;
  if (fromAteneo && (dPlazaRizal <= 600 || dEvangelista <= 600)) {
    return {
      terminalName: "Ateneo de Naga Tricycle Terminal",
      terminalCode: "T18",
      destinations: ["Plaza Rizal (Centro)", "Evangelista Street"],
      pickupPoint: "Ateneo Avenue / Bagumbayan Sur",
      dropOffTerminal: "Evangelista Tricycle Terminal (Plaza Rizal)",
      todaName: "Ateneo TODA (to Centro / Plaza Rizal)",
      corridor: "Ateneo-Centro corridor",
      regularFarePesos: 15,
      discountedFarePesos: 12,
      fareBasis: "Ordinance No. 2024-002 base minimum fare (first 3 km)",
    };
  }

  // From Calauag to Centro / Plaza Rizal
  const fromCalauag = haversineMeters(origin, { lat: 13.6419237, lng: 123.1906521 }) <= 600;
  if (fromCalauag && (dPlazaRizal <= 600 || dEvangelista <= 600)) {
    return {
      terminalName: "Calauag Tricycle Terminal",
      terminalCode: "T20",
      destinations: ["Plaza Rizal (Centro)", "Evangelista Street"],
      pickupPoint: "Calauag Street",
      dropOffTerminal: "Evangelista Tricycle Terminal (Plaza Rizal)",
      todaName: "Calauag TODA (to Centro / Plaza Rizal)",
      corridor: "Calauag-Centro corridor",
      regularFarePesos: 15,
      discountedFarePesos: 12,
      fareBasis: "Ordinance No. 2024-002 base minimum fare (first 3 km)",
    };
  }

  // From Queborac to Centro / Plaza Rizal
  const fromQueborac = haversineMeters(origin, { lat: 13.6340689, lng: 123.1852198 }) <= 500;
  if (fromQueborac && (dPlazaRizal <= 600 || dEvangelista <= 600)) {
    return {
      terminalName: "Bagumbayan-Queborac Terminal",
      terminalCode: "T19",
      destinations: ["Plaza Rizal (Centro)", "Evangelista Street"],
      pickupPoint: "Queborac Street, Bagumbayan",
      dropOffTerminal: "Evangelista Tricycle Terminal (Plaza Rizal)",
      todaName: "Bagumbayan-Queborac TODA (to Centro / Plaza Rizal)",
      corridor: "Queborac-Centro corridor",
      regularFarePesos: 15,
      discountedFarePesos: 12,
      fareBasis: "Ordinance No. 2024-002 base minimum fare (first 3 km)",
    };
  }

  // From Bagumbayan Norte Boundary to Centro / Plaza Rizal
  const fromBagumbayanNorte = haversineMeters(origin, { lat: 13.6397563, lng: 123.1855635 }) <= 600;
  if (fromBagumbayanNorte && (dPlazaRizal <= 600 || dEvangelista <= 600)) {
    return {
      terminalName: "Bagumbayan Norte Boundary Terminal",
      terminalCode: "T21",
      destinations: ["Plaza Rizal (Centro)", "Evangelista Street"],
      pickupPoint: "Bagumbayan Norte Boundary",
      dropOffTerminal: "Evangelista Tricycle Terminal (Plaza Rizal)",
      todaName: "Bagumbayan Norte TODA (to Centro / Plaza Rizal)",
      corridor: "Bagumbayan Norte-Centro corridor",
      regularFarePesos: 15,
      discountedFarePesos: 12,
      fareBasis: "Ordinance No. 2024-002 base minimum fare (first 3 km)",
    };
  }

  // From Bicol Central Station (BCS) to Centro / Plaza Rizal
  const fromBCS = haversineMeters(origin, { lat: 13.6192359, lng: 123.1897426 }) <= 500;
  if (fromBCS && (dPlazaRizal <= 600 || dEvangelista <= 600)) {
    return {
      terminalName: "Bicol Central Station (BCS) Tricycle Terminal",
      terminalCode: "T24",
      destinations: ["Plaza Rizal (Centro)", "CBD I"],
      pickupPoint: "Bicol Central Station Transport Terminal, Triangulo",
      dropOffTerminal: "Plaza Rizal East Tricycle Terminal",
      todaName: "Bicol Central Station TODA (Triangulo / CBD II)",
      corridor: "CBD II to Centro corridor",
      regularFarePesos: 15,
      discountedFarePesos: 12,
      fareBasis: "Ordinance No. 2024-002 base minimum fare (first 3 km)",
    };
  }

  // From SM City Naga to Centro / Plaza Rizal
  const fromSM = haversineMeters(origin, { lat: 13.6210765, lng: 123.1904389 }) <= 500;
  if (fromSM && (dPlazaRizal <= 600 || dEvangelista <= 600)) {
    return {
      terminalName: "SM City Naga Tricycle Transport Bay",
      terminalCode: "T25",
      destinations: ["Plaza Rizal (Centro)", "CBD I"],
      pickupPoint: "SM City Naga Transport Bay (CBD II)",
      dropOffTerminal: "Plaza Rizal East Tricycle Terminal",
      todaName: "SM City Naga TODA / E-Trike Bay",
      corridor: "CBD II to Centro corridor",
      regularFarePesos: 15,
      discountedFarePesos: 12,
      fareBasis: "Ordinance No. 2024-002 base minimum fare (first 3 km)",
    };
  }

  return null;
}
