const MAX_LENGTH = 600; // a QR code stays easy to scan

/**
 * The link the gate hands to a phone: this page's path and query on this site, so the phone opens the
 * same screen. The hash and any sign-in value in the query stay on this computer.
 */
export function deepLink({ origin, pathname, search }: Pick<Location, "origin" | "pathname" | "search">): string {
  const params = new URLSearchParams(search);
  const secret = [...params.keys()].filter((key) => /token|verifier|secret|session|^code$|^state$/i.test(key));
  secret.forEach((key) => params.delete(key));
  const query = secret.length ? (params.size ? `?${params}` : "") : search;
  return [pathname + query, pathname].map((path) => origin + path).find((url) => url.length <= MAX_LENGTH) ?? `${origin}/app`;
}
