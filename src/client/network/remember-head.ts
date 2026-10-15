"use client";

// Every time the browser reads GET /api/v1/network/head, the revision it names is remembered on
// the device (IndexedDB snapshotMeta), so the offline banner (Task 12) can say which data this
// phone last saw. Best effort: a storage failure never affects the caller.

import type { NetworkHead } from "@/domain/api/schemas";
import { writeSnapshotMeta } from "@/client/storage/db";

export function rememberHead(head: NetworkHead): void {
  writeSnapshotMeta({ revisionId: head.revisionId, publishedAt: head.publishedAt }).catch(() => undefined);
}
