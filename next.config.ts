import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";
import { testOnlyEnvProblem } from "./src/domain/pwa/build-guard";

// Test-only switches never reach a deployment build (Task 12).
const envProblem = testOnlyEnvProblem(process.env);
if (envProblem) throw new Error(envProblem);

// Baseline headers for every response. The CSP starts in Report-Only mode
// (docs/spec/05-security.md §5.10) and is enforced once MapLibre, PMTiles and
// the service worker have been verified under it. The service worker (/serwist/sw.js, Task 12)
// fetches same-origin only (connect-src 'self') and is a same-origin script (worker-src 'self').
// Browser uploads PUT straight to the object store with a presigned URL (B4/B6/B8), so that one
// origin is allowed in connect-src (spec 05 §5.10 lists https://{storage-host}). Not a secret.
const storageOrigin = (() => {
  try {
    return process.env.STORAGE_ENDPOINT ? new URL(process.env.STORAGE_ENDPOINT).origin : "";
  } catch {
    return "";
  }
})();

const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://api.maptiler.com",
  // Report a driver (task B8): the in-app camera preview and captured clips are local blob: URLs.
  "media-src 'self' blob:",
  storageOrigin ? `connect-src 'self' ${storageOrigin}` : "connect-src 'self'",
  "frame-src 'self' https://www.google.com/maps/embed/",
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
  cacheLife: {
    // The bundled service worker (src/app/serwist/[path]/route.ts) is built once, at build time,
    // and must never be regenerated within a deployment: regenerating needs the build output and
    // esbuild, which a deployed function does not have. ~10 years; a new deployment is a new build.
    serviceWorker: { stale: 315_360_000, revalidate: 315_360_000, expire: 315_360_000 + 86_400 },
  },
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
      // The admin console (N5a): never indexed, no referrer. Headers, not page metadata, so a
      // non-staff visitor's not-found page carries no admin title.
      {
        source: "/admin/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

// withSerwist keeps esbuild (used to bundle the service worker at build time) out of the server bundle.
export default withSerwist(nextConfig);
