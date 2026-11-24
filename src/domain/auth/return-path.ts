/** Where sign-in may send the browser afterwards: a page of this site's own app or admin console. */
const ALLOWED = /^\/(app|admin)(\/|$)/;

/** The sign-in page with a way back to `path`. */
export function signInHref(path: string): string {
  return `/app/sign-in?next=${encodeURIComponent(path)}`;
}

/** The path and query of a `next` value, or null when it is not a page sign-in may return to. */
export function safeReturnPath(next: string | null): string | null {
  if (!next || next.length > 1000 || !next.startsWith("/")) return null;
  const base = "https://lunad.invalid";
  try {
    // Parsed as a browser would: "//host", "/\host" and "/app/../x" show their real origin and path.
    const url = new URL(next, base);
    if (url.origin !== base || !ALLOWED.test(url.pathname) || url.pathname === "/app/sign-in") return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}
