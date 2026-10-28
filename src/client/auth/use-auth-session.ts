"use client";

import { useEffect, useState, useCallback } from "react";
import type { AuthUserDto } from "@/domain/auth/schemas";
import { getAuthClient } from "./client";

export function useAuthSession() {
  const [user, setUser] = useState<AuthUserDto | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/me", { credentials: "same-origin" });
      if (!res.ok) {
        setUser(null);
        return;
      }
      const data = await res.json();
      setUser(data.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const res = await fetch("/api/v1/me");
        if (!mounted) return;
        if (!res.ok) {
          setUser(null);
          return;
        }
        const data = await res.json();
        if (mounted) setUser(data.user ?? null);
      } catch {
        if (mounted) setUser(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    try {
      const client = await getAuthClient();
      if (client?.signOut) {
        await client.signOut();
      } else {
        await fetch("/api/auth/sign-out", { method: "POST" });
      }
    } finally {
      setUser(null);
      await refresh();
    }
  }, [refresh]);

  return { user, loading, signOut, refresh };
}
