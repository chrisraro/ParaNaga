import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);
/** Second server: the regular build (no tile URL), for the "no map background" state. */
const NO_TILES_PORT = PORT + 1;

// Two builds, two servers:
//  - PORT serves a build made for the suite in .next-e2e with a tile URL configured (the public
//    OSM template, already allowed by img-src). Every spec aborts tile requests, so nothing leaves
//    the machine, but the map does mount a tile layer and low-data mode is really exercised.
//  - NO_TILES_PORT serves the regular build (.next, from `pnpm build`), where no tile URL is set
//    as in production today. Tests tagged @no-tiles run only there (project "no-tiles").
const E2E_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const NO_TILES = /@no-tiles/;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "mobile", grepInvert: NO_TILES, use: { ...devices["Pixel 7"] } },
    { name: "desktop", grepInvert: NO_TILES, use: { ...devices["Desktop Chrome"] } },
    { name: "no-tiles", grep: NO_TILES, use: { ...devices["Pixel 7"], baseURL: `http://localhost:${NO_TILES_PORT}` } },
  ],
  webServer: [
    {
      command: `pnpm build && pnpm start --port ${PORT}`,
      env: { NEXT_DIST_DIR: ".next-e2e", NEXT_PUBLIC_TILE_URL: E2E_TILE_URL },
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
    {
      command: `pnpm start --port ${NO_TILES_PORT}`,
      url: `http://localhost:${NO_TILES_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
