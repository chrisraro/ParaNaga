// Ordering helpers shared by server and client code. Pure and dependency-free (no node:crypto),
// so client-reachable domain modules (terminal routes, search) can sort with the same rule as the
// importer and the repos.

/** Plain code-unit ordering, which equals byte order for ASCII codes and hex identities. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
