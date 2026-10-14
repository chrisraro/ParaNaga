import "server-only";
import { createNeonAuth } from "@neondatabase/auth/next/server";
import { serverEnv } from "@/server/env";

type NeonAuth = ReturnType<typeof createNeonAuth>;

let instance: NeonAuth | undefined;

/** Lazily created so builds and guest pages work before auth is configured. */
export function neonAuth(): NeonAuth | null {
  if (instance) return instance;
  const env = serverEnv();
  if (!env.NEON_AUTH_BASE_URL || !env.NEON_AUTH_COOKIE_SECRET) return null;
  instance = createNeonAuth({
    baseUrl: env.NEON_AUTH_BASE_URL,
    cookies: { secret: env.NEON_AUTH_COOKIE_SECRET, sameSite: "lax" },
    logLevel: env.NODE_ENV === "production" ? "warn" : "debug",
  });
  return instance;
}
