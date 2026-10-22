// SYNTHETIC publication fixture: an obviously fake loop, offset into a test bbox far outside Naga City
// (open sea, 0.5 N 0.5 E). is_synthetic = true; publication must refuse it. Never imported by src/.
export const synthetic = true as const;

export const TEST_BBOX = { south: 0.5, west: 0.5, north: 0.51, east: 0.51 } as const;

export const FIXTURE_LOOP_X = {
  kind: "route",
  code: "FIXTURE-X",
  name: "Fixture Loop X",
  isSynthetic: true,
  stops: [
    { kind: "stop", code: "FX-1", name: "Fixture Stop 1", lat: 0.5, lng: 0.5, isSynthetic: true },
    { kind: "stop", code: "FX-2", name: "Fixture Stop 2", lat: 0.51, lng: 0.51, isSynthetic: true },
  ],
} as const;

export const REAL_ROW = { kind: "route", code: "R1", isSynthetic: false } as const;
