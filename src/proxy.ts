import { NextResponse, type NextRequest } from "next/server";
import { E2E_ADMIN_ROLES_COOKIE, e2eAdminShellEnabled } from "@/domain/pwa/build-guard";
import { neonAuth } from "@/server/auth/neon";

// Optimistic gate only: refreshes the session cookie and bounces signed-out users.
// Real authorization happens in authorize() and RLS (spec §5.4). /admin answers a plain 404 status
// to a signed-out visitor (never a redirect that confirms the area exists). Signed-in non-staff get
// the not-found page from the /admin layout (src/server/admin/access.ts); with Cache Components
// that page streams, so its status is 200 with robots noindex, and no admin data is ever sent.
const isAdmin = (path: string) => path === "/admin" || path.startsWith("/admin/");

const adminNotFound = (from?: Response) => {
  const res = new NextResponse("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });
  // Keep any cookie the auth middleware cleared or refreshed.
  for (const cookie of from?.headers.getSetCookie?.() ?? []) res.headers.append("Set-Cookie", cookie);
  return res;
};

export async function proxy(request: NextRequest) {
  const admin = isAdmin(request.nextUrl.pathname);
  // Test-only (PARANAGA_E2E_ADMIN_SHELL, refused in deployment builds): the e2e server has no Neon
  // Auth, so the roles cookie stands in for a session (none: the signed-out 404).
  if (admin && e2eAdminShellEnabled(process.env)) {
    return request.cookies.has(E2E_ADMIN_ROLES_COOKIE) ? NextResponse.next() : adminNotFound();
  }
  const auth = neonAuth();
  if (!auth) return admin ? adminNotFound() : NextResponse.redirect(new URL("/", request.url));
  const res = await auth.middleware({ loginUrl: "/" })(request);
  if (admin && res.status >= 300 && res.status < 400) {
    const to = res.headers.get("location");
    if (to && new URL(to, request.url).pathname === "/") return adminNotFound(res);
  }
  return res;
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
