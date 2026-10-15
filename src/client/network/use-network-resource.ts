"use client";

// GET one public network resource (/api/v1/stops/:id, /api/v1/routes/:code) and validate it with
// the shared schema. A 404 is "not_found" (unknown or unpublished id); anything else that fails is
// "error" with a retry. A superseded or unmounted request is aborted.

import { useEffect, useState } from "react";

type Schema<T> = { safeParse: (v: unknown) => { success: true; data: T } | { success: false } };

export type NetworkResource<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "not_found" }
  | { status: "error"; offline: boolean };

type Settled<T> = { key: string; state: Exclude<NetworkResource<T>, { status: "loading" }> };

export function useNetworkResource<T>(url: string, schema: Schema<T>): NetworkResource<T> & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const key = `${url}#${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    const settle = (state: Settled<T>["state"]) => {
      if (!controller.signal.aborted) setSettled({ key, state });
    };
    fetch(url, { signal: controller.signal, headers: { accept: "application/json" } }).then(
      async (response) => {
        if (response.status === 404) return settle({ status: "not_found" });
        if (!response.ok) return settle({ status: "error", offline: false });
        const parsed = schema.safeParse(await response.json().catch(() => null));
        settle(parsed.success ? { status: "ready", data: parsed.data } : { status: "error", offline: false });
      },
      () => settle({ status: "error", offline: navigator.onLine === false }),
    );
    return () => controller.abort();
    // `schema` is a module constant at every call site; the request is keyed by url + attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const retry = () => setAttempt((n) => n + 1);
  if (!settled || settled.key !== key) return { status: "loading", retry };
  return { ...settled.state, retry };
}
