"use client";

import { useMemo, useSyncExternalStore } from "react";
import { encode } from "uqr";
import { useT } from "@/i18n/provider";

const noop = () => () => {};

/** This site's /app URL, known only in the browser (empty during the server render). */
export function useAppUrl() {
  return useSyncExternalStore(noop, () => `${window.location.origin}/app`, () => "");
}

export function QrCode({ value, size = 168, label }: { value: string; size?: number; label?: (url: string) => string }) {
  const qr = useMemo(() => (value ? encode(value, { ecc: "M", border: 0 }) : null), [value]);
  if (!qr) return <div style={{ width: size, height: size }} className="rounded-lg bg-fill" />;
  const n = qr.size;
  let d = "";
  qr.data.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x} ${y}h1v1h-1z`; }));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label={label ? label(value) : `QR code that opens ${value}`}>
      <path d={d} fill="#0f1e3d" />
    </svg>
  );
}

/** The landing page's code for opening the app on a phone (shown on large screens only). */
export function AppQr() {
  return <QrCode value={useAppUrl()} label={useT().landing.phone.qrLabel} />;
}
