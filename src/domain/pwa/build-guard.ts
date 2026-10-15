// Build-time guard for test-only switches (Task 12). Pure.
//
// PARANAGA_E2E_SW_VARIANT=1 lets the e2e suite change the service worker's bytes through a cookie
// (src/app/serwist/[path]/route.ts). In a deployment build it would make the worker route
// request-time (it cannot bundle at runtime) and let a cookie change the worker per visitor, so
// next.config.ts refuses to build with it in any deployment environment.

export const TEST_ONLY_SW_VARIANT = "PARANAGA_E2E_SW_VARIANT";

/** Variables that mark a deployment build (Vercel sets VERCEL and VERCEL_ENV during builds). */
const DEPLOYMENT_MARKERS = ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "NETLIFY", "CF_PAGES"] as const;

/** The reason the build must stop, or null when the environment is fine. */
export function testOnlyEnvProblem(env: Readonly<Record<string, string | undefined>>): string | null {
  if (!env[TEST_ONLY_SW_VARIANT]) return null;
  const marker = DEPLOYMENT_MARKERS.find((name) => env[name]);
  if (marker) return `${TEST_ONLY_SW_VARIANT} is test-only and must not be set in a deployment build (${marker} is set).`;
  return null;
}
