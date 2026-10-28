import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { and, eq, isNull, sql } from "drizzle-orm";
import { isRole, type Role } from "@/domain/auth/permissions";
import { withRequestContext, type RequestContext } from "@/server/db/context";
import { profile, userRole } from "@/server/db/schema";
import { safeRequestId } from "@/server/request-id";
import { neonAuth } from "./neon";

export type CurrentUser = { id: string; name: string; roles: Role[] };

// Client-supplied ids end up in logs and audit rows, so accept only a safe shape.
export const requestId = cache(async (): Promise<string> => {
  const h = await headers();
  return safeRequestId(h.get("x-vercel-id") ?? h.get("x-request-id"));
});

/**
 * The Neon Auth session behind this request (validated server-side): ids, email and when the user
 * signed in (the session's creation time; a refresh keeps it), no roles.
 */
export type AuthSession = { userId: string; sessionId: string | null; email: string | null; authenticatedAt: Date | null };

/** Neon Auth's session for this request, memoized per request; null for guests. Used by step-up. */
export const getAuthSession = cache(async (): Promise<AuthSession | null> => {
  const auth = neonAuth();
  if (!auth) return null;
  const { data } = await auth.getSession();
  const user = data?.user;
  if (!user?.id) return null;
  const sessionId: unknown = data?.session?.id;
  const email: unknown = user.email;
  const createdAt: unknown = data?.session?.createdAt;
  const authenticatedAt = createdAt == null ? null : new Date(createdAt as string | number | Date);
  return {
    userId: user.id,
    sessionId: typeof sessionId === "string" && sessionId ? sessionId : null,
    email: typeof email === "string" && email ? email : null,
    authenticatedAt: authenticatedAt && !Number.isNaN(authenticatedAt.getTime()) ? authenticatedAt : null,
  };
});

/**
 * Session + roles for this request, memoized per request.
 * Roles always come from core.user_role, never from auth metadata (spec §5.4).
 * Components calling this read cookies, so they must sit behind <Suspense>.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const auth = neonAuth();
  if (!auth) return null;
  const { data } = await auth.getSession();
  const user = data?.user;
  if (!user?.id) return null;

  const ctx: RequestContext = { userId: user.id, requestId: await requestId() };
  const roles = await withRequestContext(ctx, async (db) => {
    let [account] = await db
      .select({ suspendedUntil: profile.suspendedUntil })
      .from(profile)
      .where(eq(profile.userId, user.id));
    if (!account) {
      // First sign-in only: the definer function creates profile + commuter role and
      // does nothing if a profile already exists, so revoked roles stay revoked.
      await db.execute(sql`select core.ensure_commuter(${user.name ?? ""})`);
      account = { suspendedUntil: null };
    }
    if (account.suspendedUntil && account.suspendedUntil > new Date()) return [];
    const rows = await db
      .select({ role: userRole.roleCode })
      .from(userRole)
      .where(and(eq(userRole.userId, user.id), isNull(userRole.revokedAt)));
    return rows.map((r) => r.role);
  });

  return { id: user.id, name: user.name ?? "", roles: roles.filter(isRole) };
});

export async function getRequestContext(): Promise<RequestContext> {
  const user = await getCurrentUser();
  return { userId: user?.id ?? null, requestId: await requestId() };
}
