// No `server-only` import: integration tests run these exact statements against a real branch.
import { sql } from "drizzle-orm";
import type { Db } from "./run-in-context";

/** Removes the user's own saved places by client id (RLS also scopes it to the user). */
export function deleteSavedPlaces(db: Db, userId: string, ids: string[]) {
  return db.execute(sql`delete from core.saved_place where user_id = ${userId} and client_id = any(${sql.param(ids)}::text[])`);
}

/** Removes the user's own saved trips by client id (RLS also scopes it to the user). */
export function deleteSavedTrips(db: Db, userId: string, ids: string[]) {
  return db.execute(sql`delete from core.saved_trip where user_id = ${userId} and client_id = any(${sql.param(ids)}::text[])`);
}
