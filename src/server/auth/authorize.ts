import "server-only";
import { decide, type Action, type Resource } from "@/domain/auth/permissions";
import { getCurrentUser, type CurrentUser } from "./session";

export class AuthorizationError extends Error {
  constructor(
    readonly reason: "unauthenticated" | "forbidden" | "self_review",
    readonly action: Action,
  ) {
    super(`Not allowed: ${action} (${reason})`);
    this.name = "AuthorizationError";
  }
}

/**
 * First wall for every Route Handler and Server Action (spec §5.5).
 * Throws; never returns false silently. RLS repeats the check in Postgres.
 */
export async function authorize(action: Action, resource?: Resource): Promise<CurrentUser> {
  const user = await getCurrentUser();
  const decision = decide(user, action, resource);
  if (!decision.allowed) throw new AuthorizationError(decision.reason, action);
  return user as CurrentUser;
}
