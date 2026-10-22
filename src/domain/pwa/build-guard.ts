// Build-time guard for test-only switches (Task 12, N5a). Pure.
//
// PARANAGA_E2E_SW_VARIANT=1 lets the e2e suite change the service worker's bytes through a cookie
// (src/app/serwist/[path]/route.ts). In a deployment build it would make the worker route
// request-time (it cannot bundle at runtime) and let a cookie change the worker per visitor.
//
// PARANAGA_E2E_ADMIN_SHELL=1 lets the e2e suite open the /admin SHELL (layout and nav) with a
// cookie naming the roles, because the e2e server has no Neon Auth or database
// (src/server/admin/access.ts). It never reaches data: every admin API still runs the real
// session, role and database checks, and the e2e specs answer those APIs with page routes.
//
// next.config.ts refuses to build with either one in any deployment environment, and the admin
// switch is also ignored at runtime when a deployment marker is set.

export const TEST_ONLY_SW_VARIANT = "PARANAGA_E2E_SW_VARIANT";
export const TEST_ONLY_ADMIN_SHELL = "PARANAGA_E2E_ADMIN_SHELL";
/** With TEST_ONLY_ADMIN_SHELL on: the cookie naming the e2e user's roles (comma-separated). */
export const E2E_ADMIN_ROLES_COOKIE = "pn-e2e-admin-roles";
const TEST_ONLY = [TEST_ONLY_SW_VARIANT, TEST_ONLY_ADMIN_SHELL] as const;

/** Variables that mark a deployment build (Vercel sets VERCEL and VERCEL_ENV during builds). */
const DEPLOYMENT_MARKERS = ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "NETLIFY", "CF_PAGES"] as const;

type Env = Readonly<Record<string, string | undefined>>;

const deploymentMarker = (env: Env) => DEPLOYMENT_MARKERS.find((name) => env[name]);

/** The reason the build must stop, or null when the environment is fine. */
export function testOnlyEnvProblem(env: Env): string | null {
  const name = TEST_ONLY.find((n) => env[n]);
  if (!name) return null;
  const marker = deploymentMarker(env);
  if (marker) return `${name} is test-only and must not be set in a deployment build (${marker} is set).`;
  return null;
}

/** The e2e admin-shell switch is on: exactly "1", and no deployment marker at runtime either. */
export function e2eAdminShellEnabled(env: Env): boolean {
  return env[TEST_ONLY_ADMIN_SHELL] === "1" && !deploymentMarker(env);
}
