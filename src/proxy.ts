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
  matcher: ["/account/:path*", "/admin/:path*"],
};
