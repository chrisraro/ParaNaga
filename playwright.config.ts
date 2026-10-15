import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);
/** Second server: a build with no tile URL, for the "no map background" state. */
const NO_TILES_PORT = PORT + 1;

// Two builds, two servers:
//  - PORT serves a build made for the suite in .next-e2e with a tile URL configured (the public
//    OSM template, already allowed by img-src). Every spec aborts tile requests, so nothing leaves
//    the machine, but the map does mount a tile layer and low-data mode is really exercised.
//  - NO_TILES_PORT serves a second build in .next-e2e-notiles with NEXT_PUBLIC_TILE_URL="" (an
//    empty process env value wins over .env.local), so it renders no basemap as in production
//    today, independent of a prior `pnpm build` or the local env. Tests tagged @no-tiles run
//    only there (project "no-tiles"). The servers start one after the other, so the builds never
//    run concurrently.
const E2E_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const NO_TILES = /@no-tiles/;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // The service worker (Task 12) is blocked by default: the specs answer the API with page routes,
  // which never see a worker's own requests. tests/e2e/offline.spec.ts allows it and routes on the
  // browser context instead.
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", serviceWorkers: "block" },
  projects: [
    { name: "mobile", grepInvert: NO_TILES, use: { ...devices["Pixel 7"] } },
    { name: "desktop", grepInvert: NO_TILES, use: { ...devices["Desktop Chrome"] } },
    { name: "no-tiles", grep: NO_TILES, use: { ...devices["Pixel 7"], baseURL: `http://localhost:${NO_TILES_PORT}` } },
  ],
  webServer: [
    {
      command: `pnpm build && pnpm start --port ${PORT}`,
      // PARANAGA_E2E_SW_VARIANT: test-only, lets offline.spec.ts publish new worker bytes at the
      // same URL through a cookie (src/app/serwist/[path]/route.ts). Never set for a deployment.
      env: { NEXT_DIST_DIR: ".next-e2e", NEXT_PUBLIC_TILE_URL: E2E_TILE_URL, PARANAGA_E2E_SW_VARIANT: "1" },
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
    {
      command: `pnpm build && pnpm start --port ${NO_TILES_PORT}`,
      env: { NEXT_DIST_DIR: ".next-e2e-notiles", NEXT_PUBLIC_TILE_URL: "" },
      url: `http://localhost:${NO_TILES_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
  ],
});
