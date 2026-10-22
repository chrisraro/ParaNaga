import { postImportCommit } from "@/server/admin/handlers";

// Commit of an uploaded KML/CSV into ingest.* and the open draft (N5b, C2); idempotent on a rerun.
export function POST(request: Request) {
  return postImportCommit(request);
}
