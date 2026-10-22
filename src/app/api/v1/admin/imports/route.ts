import { getImports } from "@/server/admin/handlers";

// Import batches and the baseline the next import is diffed against (N5b, C2).
export function GET(request: Request) {
  return getImports(request);
}
