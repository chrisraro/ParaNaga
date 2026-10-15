import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cacheLife } from "next/cache";
import { createSerwistRoute } from "@serwist/turbopack";
import { linkedIconUrls } from "@/domain/pwa/sw-routes";

// Serves the service worker (src/app/sw.ts), bundled by esbuild at build time, at /serwist/sw.js
// with `Service-Worker-Allowed: /` so it can control the whole app. Task 12 spike: Serwist's
// Turbopack integration builds on Next 16.4.1 with cacheComponents when only `generateStaticParams`
// and `GET` are exported (route segment config such as `dynamic` is not allowed with Cache
// Components) and the bundling runs inside "use cache" (workerScript), which keeps /serwist/sw.js
// prerendered at build time. The security headers come from next.config.ts like every other path;
// the script itself is always revalidated (`no-cache`) so an update is found on the next visit.

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

/**
 * The bundled worker, cached for the life of the deployment ("use cache" with the
 * "serviceWorker" profile of next.config.ts: ~10 years, so it is never regenerated at runtime,
 * where the build output and esbuild are not available). With Cache Components a
 * route handler is prerendered only if its I/O (here globbing the build output and running
 * esbuild) happens inside a cache scope, otherwise the route becomes request-time and would bundle
 * at runtime, where the build output is not available.
 */
async function workerScript(): Promise<string> {
  "use cache";
  cacheLife("serviceWorker");
  const response = await serwist.GET(new Request("http://localhost/serwist/sw.js"), { params: Promise.resolve({ path: "sw.js" }) });
  return response.text();
}

/**
 * Test-only (the e2e build sets PARANAGA_E2E_SW_VARIANT=1; never set for a deployment): a cookie
 * appends a comment to the script, so the e2e suite can publish "new worker bytes" at the same URL
 * and exercise a real update. Without the variable the request is never read.
 */
function e2eVariant(request: Request): string | null {
  if (process.env.PARANAGA_E2E_SW_VARIANT !== "1") return null;
  return /(?:^|;\s*)e2e-sw-variant=([\w-]{1,32})/.exec(request.headers.get("cookie") ?? "")?.[1] ?? null;
}

export async function GET(request: Request, context: { params: Promise<{ path: string }> }) {
  // Only the worker itself: any other /serwist/* path never runs the bundler.
  if ((await context.params).path !== "sw.js") return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const variant = e2eVariant(request);
  const script = await workerScript();
  const body = variant === null ? script : `${script}\n// e2e variant ${variant}\n`;
  return new Response(body, {
    headers: { "Content-Type": "application/javascript; charset=utf-8", "Service-Worker-Allowed": "/", "Cache-Control": "no-cache" },
  });
}
