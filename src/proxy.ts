import { NextResponse, type NextRequest } from "next/server";
import { neonAuth } from "@/server/auth/neon";

// Optimistic gate only: refreshes the session cookie and bounces signed-out users.
// Real authorization happens in authorize() and RLS (spec §5.4).
export async function proxy(request: NextRequest) {
  const auth = neonAuth();
  if (!auth) return NextResponse.redirect(new URL("/", request.url));
  return auth.middleware({ loginUrl: "/" })(request);
}

export const config = {
  matcher: [
    "/account/:path*",
    "/admin/:path*",
    // The Google return trip: Neon sends the browser back with a one-time token in the URL, and only the
    // Neon Auth middleware can swap it for the session cookie. Runs only when that token is present, so
    // ordinary /app navigation never pays for the proxy.
    { source: "/app/:path*", has: [{ type: "query", key: "neon_auth_session_verifier" }] },
  ],
};
