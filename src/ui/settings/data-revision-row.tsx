"use client";

// "Data revision · {label} · {published date}" (More → About, Help → About data), read from
// GET /api/v1/network/head; the revision seen is remembered on the device (rememberHead).

import "@/ui/kit/styles";

import { useEffect } from "react";
import { rememberHead } from "@/client/network/remember-head";
import { useNetworkResource } from "@/client/network/use-network-resource";
import { networkHeadSchema, type NetworkHead } from "@/domain/api/schemas";
import { publishedDateText } from "@/domain/network/present";
import { ListCell } from "@/ui/kit/list";

/** "provisional-loops-2026-10-15 · Oct 15, 2026" (published date in Naga City time). */
export function revisionLine(head: NetworkHead): string {
  const date = publishedDateText(head.publishedAt) ?? "publication date not recorded";
  return `${head.label} · ${date}`;
}

/** "Data revision · {label} · {published date}" from GET /api/v1/network/head (More, Help → About data). */
export function DataRevisionRow({ testId = "settings-data-revision" }: { testId?: string }) {
  const head = useNetworkResource("/api/v1/network/head", networkHeadSchema);
  const seen = head.status === "ready" ? head.data : null;
  useEffect(() => {
    if (seen) rememberHead(seen);
  }, [seen]);
  let sub: string;
  if (head.status === "ready") sub = revisionLine(head.data);
  else if (head.status === "loading") sub = "Checking…";
  else if (head.status === "error" && head.offline) sub = "Not available offline";
  else sub = "Not available right now";
  return <ListCell title="Data revision" sub={sub} testId={testId} />;
}
