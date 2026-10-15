"use client";

// The geolocation permission state for Settings, live (PermissionStatus "change"). Only queries
// the permission; it never asks for a location. null while the query is pending.

import { useEffect, useState } from "react";
import { toLocationPermission, type LocationPermission } from "@/domain/device/location-permission";

export function useLocationPermission(): LocationPermission | null {
  const [state, setState] = useState<LocationPermission | null>(null);

  useEffect(() => {
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const onChange = () => {
      if (!cancelled && status) setState(toLocationPermission(status.state));
    };
    const supported = window.isSecureContext && "geolocation" in navigator && typeof navigator.permissions?.query === "function";
    if (!supported) {
      // Async like the query, so the effect never sets state synchronously.
      queueMicrotask(() => {
        if (!cancelled) setState("unsupported");
      });
    } else {
      navigator.permissions.query({ name: "geolocation" }).then(
        (result) => {
          if (cancelled) return;
          status = result;
          status.addEventListener("change", onChange);
          onChange();
        },
        () => {
          if (!cancelled) setState("unsupported");
        },
      );
    }
    return () => {
      cancelled = true;
      status?.removeEventListener("change", onChange);
    };
  }, []);

  return state;
}
