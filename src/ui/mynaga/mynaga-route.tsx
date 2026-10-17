"use client";

// /app/mynaga: the informational screen, or, with ?report=<id>, the handoff for one of the
// person's own driver reports. The id is an opaque random UUID; the report itself loads from the
// owner-only endpoint, so the id alone reveals nothing.

import { useSearchParams } from "next/navigation";
import { MyNagaScreen } from "./mynaga-screen";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function MyNagaRoute() {
  const report = useSearchParams().get("report");
  return <MyNagaScreen reportId={report && UUID_RE.test(report) ? report.toLowerCase() : undefined} />;
}
