import { postImportDryRun } from "@/server/admin/handlers";

// Dry run of an uploaded KML/CSV against the baseline (N5b, C2). Writes nothing.
export function POST(request: Request) {
  return postImportDryRun(request);
}
