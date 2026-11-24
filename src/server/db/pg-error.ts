import "server-only";

type PgFields = { code?: unknown; constraint?: unknown };

/** A Postgres error field, whether the driver error is wrapped (Drizzle) or not. */
function field(error: unknown, name: keyof PgFields): string | undefined {
  const e = error as (PgFields & { cause?: PgFields | null }) | null | undefined;
  const value = e?.[name] ?? e?.cause?.[name];
  return typeof value === "string" ? value : undefined;
}

export const pgCode = (error: unknown) => field(error, "code");

/** Deadlock victim, serialization failure, or a lock or statement timeout (0035): the transaction rolled back whole and may be sent again. */
export function isTransientConflict(error: unknown): boolean {
  const code = pgCode(error);
  return code === "40P01" || code === "40001" || code === "55P03" || code === "57014";
}

/**
 * Two overlapping copies of one request: both look for the stored row, both insert, and the second
 * fails with 23505 once the first has committed. Only for the named constraint, and only once, runs
 * `recover` (by default the whole transaction again, whose lookup now finds the stored row). Any
 * other unique violation is thrown unchanged. `run` must open its own transaction.
 */
export async function onDuplicate<T>(constraint: string, run: () => Promise<T>, recover: () => Promise<T> = run): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (pgCode(error) !== "23505" || field(error, "constraint") !== constraint) throw error;
    return recover();
  }
}
