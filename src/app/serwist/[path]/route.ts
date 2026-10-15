import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createSerwistRoute } from "@serwist/turbopack";
import { linkedIconUrls } from "@/domain/pwa/sw-routes";

// Serves the service worker (src/app/sw.ts), bundled by esbuild at build time, at /serwist/sw.js
// with `Service-Worker-Allowed: /` so it can control the whole app. Task 12 spike: Serwist's
// Turbopack integration builds on Next 16.4.1 with cacheComponents when only `generateStaticParams`
// and `GET` are exported (route segment config such as `dynamic` is not allowed with Cache
// Components). The security headers come from next.config.ts like every other path; the script
// itself is always revalidated (`no-cache`, next.config.ts) so an update is found on the next visit.

/** The web app manifest is generated from src/app/manifest.ts: its revision is that file's hash. */
function manifestRevision(): string {
  try {
    return createHash("sha256").update(readFileSync("src/app/manifest.ts")).digest("hex").slice(0, 16);
  } catch {
    return "unknown";
  }
}

const serwist = createSerwistRoute({
  swSrc: "src/app/sw.ts",
  // Native esbuild (a pinned devDependency) on every platform, a classic (non-module) worker for
  // the widest browser support, no source map served.
  useNativeEsbuild: true,
  esbuildOptions: { format: "iife", sourcemap: false },
  globIgnores: ["**/*.map"],
  // Build assets and public files (/theme-init.js, /icons/*) come from the build output; the
  // manifest and the icons as the HTML links them are added here. The static page shells are
  // cached by the worker itself at install (see sw.ts).
  additionalPrecacheEntries: [{ url: "/manifest.webmanifest", revision: manifestRevision() }],
  manifestTransforms: [
    async (entries) => ({
      manifest: [...entries, ...linkedIconUrls(entries.map((e) => e.url)).map((url) => ({ url, revision: null, size: 0 }))],
      warnings: [],
    }),
  ],
});

export const generateStaticParams = serwist.generateStaticParams;

export async function GET(request: Request, context: { params: Promise<{ path: string }> }) {
  const response = await serwist.GET(request, context);
  response.headers.set("Cache-Control", "no-cache");
  return response;
}
