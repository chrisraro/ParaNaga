import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

// Baseline headers for every response. The CSP starts in Report-Only mode
// (docs/spec/05-security.md §5.10) and is enforced once MapLibre, PMTiles and
// the service worker have been verified under it. The service worker (/serwist/sw.js, Task 12)
// fetches same-origin only (connect-src 'self') and is a same-origin script (worker-src 'self').
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://api.maptiler.com",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "child-src blob:",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "report-uri /api/csp-report",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-site" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR is test-only: the e2e suite builds its own copies (.next-e2e with a tile URL,
  // .next-e2e-notiles without) so it never overwrites the regular build (playwright.config.ts).
  // Never set it for a deployment.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  experimental: {
    // Soft navigations, prefetches and Server Actions stay pending offline and retry on
    // reconnect instead of throwing (useOffline from next/offline drives the offline UI, Task 12).
    useOffline: true,
    // The Tailwind CSS loader's output was served from a stale build cache after
    // globals.css changed (old base styles + new utilities), on Vercel too since it
    // restores .next/cache. Production builds always compile fresh; dev keeps its cache.
    turbopackFileSystemCacheForBuild: false,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The service worker script: always revalidated, so an update is found on the next visit.
      { source: "/serwist/:path*", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};

// withSerwist keeps esbuild (used to bundle the service worker at build time) out of the server bundle.
export default withSerwist(nextConfig);
