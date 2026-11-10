"use client";

import { useEffect, useState, useCallback } from "react";
import type { AuthUserDto } from "@/domain/auth/schemas";
import { getAuthClient } from "./client";

/**
 * `unknown`: the check did not get an answer (offline, a server error). The person may well be
 * signed in, so it is never shown as signed out: offer to check again instead of asking to sign in.
 */
export type AuthSession =
  | { status: "checking"; user: null }
  | { status: "signedIn"; user: AuthUserDto }
  | { status: "signedOut"; user: null }
  | { status: "unknown"; user: null };

const CHECKING: AuthSession = { status: "checking", user: null };
const SIGNED_OUT: AuthSession = { status: "signedOut", user: null };
const UNKNOWN: AuthSession = { status: "unknown", user: null };

/** GET /api/v1/me answers 200 for guests too (`user: null`); anything else is no answer. */
async function checkSession(): Promise<AuthSession> {
  try {
    const res = await fetch("/api/v1/me", { credentials: "same-origin" });
    if (!res.ok) return UNKNOWN;
    const data = (await res.json()) as { user?: AuthUserDto | null };
    return data.user ? { status: "signedIn", user: data.user } : SIGNED_OUT;
  } catch {
    return UNKNOWN;
  }
}

export function useAuthSession() {
  const [session, setSession] = useState<AuthSession>(CHECKING);

  const [refreshing, setRefreshing] = useState(false);

  /** Checks again; the current answer stays on screen until the new one is in (`refreshing` meanwhile). */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    const next = await checkSession();
    setSession(next);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    void checkSession().then((next) => {
      if (mounted) setSession(next);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    let done = true;
    try {
      const client = await getAuthClient();
      if (client?.signOut) {
        const result = await client.signOut();
        if (result?.error) done = false;
      } else {
        done = (await fetch("/api/auth/sign-out", { method: "POST" })).ok;
      }
    } catch {
      done = false;
    }
    const next = await checkSession();
    // No answer from the check: go by the sign-out itself. A failed one never reads as signed out
    // (the session is most likely still valid on the server), so what is on screen stays.
    if (next.status !== "unknown") setSession(next);
    else if (done) setSession(SIGNED_OUT);
  }, []);

  return { user: session.user, loading: session.status === "checking", status: session.status, signOut, refresh, refreshing };
}
